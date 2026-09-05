// lib/batch/run-batch.ts — the core pipeline: circuit breaker -> diagnosis ->
// decision -> promise tracker -> compliance gate -> execution, for every
// record in a batch. This is what app/api/batch/route.ts calls.
//
// Rule 6's special case (missing pre-debit notice) is handled here, not in
// the gate itself: when the gate blocks an action WITH a rescheduleTo, this
// orchestrator builds a second action — sending the notice — gates THAT
// action too (it still owes Rule 1/2/3/4/5/12/13, just not Rule 6/7/8, which
// only apply to actual debit attempts), executes it if allowed, and leaves
// the original retry logged as rescheduled rather than executed this run
// (realistically, a retry that needs 24h notice can't happen in the same
// pass — it belongs to a future batch run once the notice window has passed).
import type { SeedBatch, PaymentFailure, CheckoutAbandonment, B2BReceivable, PreferredLanguage } from "@/data/seed/schema";
import type { ProposedAction, RecordType } from "@/lib/actions/types";
import { runCircuitBreaker, type CircuitBreakerOutcome } from "@/lib/circuit-breaker/index";
import { diagnosePaymentFailure, diagnoseCheckoutAbandonment, diagnoseB2BReceivable } from "@/lib/classifier/ai-fallback";
import { decidePaymentFailureActions, decideCheckoutAbandonmentActions, decideB2BReceivableActions } from "@/lib/actions/decision-table";
import { applyPromiseTrackerOverrides, runPromiseLifecycle } from "@/lib/promise-tracker/state-machine";
import { buildCustomerContext, resetContextBackfillForTests, type ContextBaselineInput } from "@/lib/rules/context";
import { runComplianceGate, type GateResult } from "@/lib/rules/gate";
import { executeAllowedAction, type ExecutionOutcome } from "@/lib/execution/execute";
import { nextValidComplianceSlot, IST_TIME_ZONE } from "@/lib/time/ist";
import { logAuditEvent, clearAuditLogForNewBatchRun } from "@/lib/audit/log";
import { resetPromiseTrackerForTests } from "@/lib/promise-tracker/state-machine";
import { createRng } from "@/data/seed/rng";
import { isToneDemoCase } from "@/data/seed/constants";
import { fromZonedTime } from "date-fns-tz";

// B2BReceivable has no per-record timestamp field (only invoice_due_date and
// days_overdue), so its proposed contact time needs a "now" reference the
// way PF/CA get one from attempted_at/abandoned_at. Using real wall-clock
// Date.now() here would make every B2B outcome depend on what time of day
// someone happens to click "Run the batch" (e.g. running it at 8 PM would
// fail Rule 1 for literally every B2B action) — a real bug caught by
// browser-testing at 7:45 PM IST, where every B2B case was blocked for that
// reason alone. A fixed IST anchor, safely inside the contact window, keeps
// the batch fully reproducible regardless of real run time.
const DEFAULT_B2B_NOW = fromZonedTime("2026-08-12T10:00:00", IST_TIME_ZONE);

// Processes records with bounded concurrency, preserving input order in the
// output — safe ONLY for record types with no cross-record dependencies
// (i.e. every record's customer/business identifier is unique within the
// batch, so one record's audit history can never affect another's Rule 2/3
// evaluation). Verified against the real seed: PF and CA customer_ids are
// 100% unique; B2B business_name is NOT (42 unique of 58 — the generator's
// small prefix x suffix combinatorial pool collides), so B2B stays strictly
// sequential below. This exists because awaiting each record's real Gemini/
// Razorpay calls one at a time pushed a full batch run close to Vercel's
// 60s Hobby-tier ceiling (57s observed live) — discovered only once Supabase
// persistence started actually succeeding and there was nothing left to hide
// the network latency of ~124 real LLM calls per run.
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
const RECORD_CONCURRENCY = 8;

export type BatchActionOutcome = {
  proposedAction: ProposedAction;
  gateResult: GateResult;
  execution?: ExecutionOutcome;
  /** Present only for the notice action auto-inserted by a Rule 6 reschedule. */
  isAutoInsertedNotice?: boolean;
};

/** Phase 12's counterfactual: what a version of Firmline with no compliance
 * gate would have done. Definitionally "always allowed, fires at whatever
 * time the Decision layer originally proposed, no reschedule, no Rule 9
 * tone check" — cheap to derive from the same decision-layer output rather
 * than re-running a real second gate pass. */
export type NaiveActionSummary = {
  actionType: string;
  proposedAt: string;
  discountPercent?: number;
};

export type BatchCaseResult = {
  caseId: string;
  customerId: string;
  recordType: RecordType | "circuit_breaker_paused";
  rootCause: string;
  diagnosisConfidence: number;
  diagnosisSource: string;
  needsHumanReview: boolean;
  pausedByCircuitBreaker: boolean;
  actions: BatchActionOutcome[];
  naiveActions: NaiveActionSummary[];
};

function toNaiveSummaries(actions: ProposedAction[]): NaiveActionSummary[] {
  return actions.map((a) => ({ actionType: a.actionType, proposedAt: a.proposedAt.toISOString(), discountPercent: a.discountPercent }));
}

export type BatchResult = {
  circuitBreaker: CircuitBreakerOutcome;
  cases: BatchCaseResult[];
};

const PROMISE_TRACKER_RNG_SEED = 20260810 + 1; // distinct from the data-generator seed, still fixed/reproducible

type ExecContext = {
  customerName: string;
  language: PreferredLanguage;
  amountInr?: number;
  useDeliberateNaiveTemplate?: boolean;
};

async function gateAndExecute(action: ProposedAction, baseline: ContextBaselineInput, execCtx: ExecContext): Promise<BatchActionOutcome[]> {
  const outcomes: BatchActionOutcome[] = [];
  const context = await buildCustomerContext(baseline, action);
  const gateResult = await runComplianceGate(action, context);

  if (gateResult.allowed) {
    const execution = await executeAllowedAction({
      action,
      customerName: execCtx.customerName,
      language: execCtx.language,
      amountInr: execCtx.amountInr,
      discountPercent: action.discountPercent,
      useDeliberateNaiveTemplate: execCtx.useDeliberateNaiveTemplate,
    });
    outcomes.push({ proposedAction: action, gateResult, execution });
    return outcomes;
  }

  outcomes.push({ proposedAction: action, gateResult });

  if (gateResult.rescheduleTo) {
    const noticeAction: ProposedAction = {
      ...action,
      actionType: "SEND_PRE_DEBIT_NOTICE_THEN_RETRY",
      proposedAt: nextValidComplianceSlot(action.proposedAt, false),
    };
    const noticeContext = await buildCustomerContext(baseline, noticeAction);
    const noticeGate = await runComplianceGate(noticeAction, noticeContext);
    let noticeExecution: ExecutionOutcome | undefined;
    if (noticeGate.allowed) {
      noticeExecution = await executeAllowedAction({
        action: noticeAction,
        customerName: execCtx.customerName,
        language: execCtx.language,
        amountInr: execCtx.amountInr,
      });
    }
    outcomes.push({ proposedAction: noticeAction, gateResult: noticeGate, execution: noticeExecution, isAutoInsertedNotice: true });

    await logAuditEvent({
      case_id: action.caseId,
      customer_id: action.customerId,
      mandate_id: action.mandateId ?? null,
      layer: "execution",
      event_type: "action_rescheduled",
      reasoning_text: `Original ${action.actionType} rescheduled to ${gateResult.rescheduleTo.toISOString()}, pending the 24h pre-debit notice window — will be re-evaluated in a future batch run.`,
      detail: { rescheduleTo: gateResult.rescheduleTo.toISOString() },
    });
  }

  return outcomes;
}

async function processActions(actions: ProposedAction[], baseline: ContextBaselineInput, execCtx: ExecContext): Promise<BatchActionOutcome[]> {
  const overridden = applyPromiseTrackerOverrides(actions);
  const outcomes: BatchActionOutcome[] = [];
  for (const action of overridden) {
    outcomes.push(...(await gateAndExecute(action, baseline, execCtx)));
  }
  return outcomes;
}

async function processPaymentFailure(r: PaymentFailure): Promise<BatchCaseResult> {
  const diag = await diagnosePaymentFailure(r);
  const actions = decidePaymentFailureActions(r, diag.rootCause);
  const baseline: ContextBaselineInput = {
    customerId: r.customer_id,
    isOptedOut: r.is_opted_out,
    isDisputed: r.is_disputed,
    customerSegment: r.customer_segment,
    lastContactStatus: r.last_contact_status,
    previousAttemptsToday: r.previous_attempts_today,
    previousAttemptsTotal21d: r.previous_attempts_total_21d,
    verifiedPhone: r.customer_phone,
    verifiedEmail: r.customer_email,
    mandateId: r.mandate_id,
  };
  const outcomes = await processActions(actions, baseline, {
    customerName: r.customer_name,
    language: r.preferred_language,
    amountInr: r.amount_inr,
  });
  return {
    caseId: r.id,
    customerId: r.customer_id,
    recordType: "payment_failure",
    rootCause: diag.rootCause,
    diagnosisConfidence: diag.confidence,
    diagnosisSource: diag.source,
    needsHumanReview: !!diag.needsHumanReview,
    pausedByCircuitBreaker: false,
    actions: outcomes,
    naiveActions: toNaiveSummaries(actions),
  };
}

async function processCheckoutAbandonment(r: CheckoutAbandonment): Promise<BatchCaseResult> {
  const diag = await diagnoseCheckoutAbandonment(r);
  const actions = decideCheckoutAbandonmentActions(r, diag.rootCause);
  const baseline: ContextBaselineInput = {
    customerId: r.customer_id,
    isOptedOut: r.is_opted_out,
    isDisputed: false,
    customerSegment: r.customer_segment,
    lastContactStatus: "NO_PRIOR_CONTACT",
    previousAttemptsToday: 0,
    previousAttemptsTotal21d: 0,
    verifiedPhone: r.customer_phone,
    verifiedEmail: r.customer_email,
  };
  const outcomes = await processActions(actions, baseline, {
    customerName: r.customer_name,
    language: r.preferred_language,
    amountInr: r.cart_value_inr,
  });
  return {
    caseId: r.id,
    customerId: r.customer_id,
    recordType: "checkout_abandonment",
    rootCause: diag.rootCause,
    diagnosisConfidence: diag.confidence,
    diagnosisSource: diag.source,
    needsHumanReview: !!diag.needsHumanReview,
    pausedByCircuitBreaker: false,
    actions: outcomes,
    naiveActions: toNaiveSummaries(actions),
  };
}

async function processB2BReceivable(r: B2BReceivable, now: Date, rng: ReturnType<typeof createRng>): Promise<BatchCaseResult> {
  const diag = await diagnoseB2BReceivable(r);
  const actions = decideB2BReceivableActions(r, diag.rootCause, now);
  const baseline: ContextBaselineInput = {
    customerId: r.business_name,
    isOptedOut: r.is_opted_out,
    isDisputed: r.dispute_flag,
    customerSegment: null,
    lastContactStatus: "NO_PRIOR_CONTACT",
    previousAttemptsToday: 0,
    previousAttemptsTotal21d: 0,
    verifiedPhone: r.contact_phone,
    verifiedEmail: r.contact_email,
  };

  if (actions.some((a) => a.actionType === "CAPTURE_PROMISE_TO_PAY")) {
    await runPromiseLifecycle(r.id, r.business_name, r.payment_history_pattern, rng);
  }

  const outcomes = await processActions(actions, baseline, {
    customerName: r.contact_name,
    language: r.preferred_language,
    amountInr: r.invoice_amount_inr,
    useDeliberateNaiveTemplate: isToneDemoCase(r),
  });
  return {
    caseId: r.id,
    customerId: r.business_name,
    recordType: "b2b_receivable",
    rootCause: diag.rootCause,
    diagnosisConfidence: diag.confidence,
    diagnosisSource: diag.source,
    needsHumanReview: !!diag.needsHumanReview,
    pausedByCircuitBreaker: false,
    actions: outcomes,
    naiveActions: toNaiveSummaries(actions),
  };
}

export async function runBatchPipeline(batch: SeedBatch, now: Date = DEFAULT_B2B_NOW): Promise<BatchResult> {
  // Every batch run starts from a clean slate: the audit log, the seed-baseline
  // backfill tracking, and promise-tracker state must not carry over from a
  // previous run, or a re-run would see its own prior run's real executed
  // events as "recent history" and cascade into spurious compliance blocks —
  // a real bug caught by manually re-running the batch twice in a row.
  await clearAuditLogForNewBatchRun();
  resetContextBackfillForTests();
  resetPromiseTrackerForTests();

  const circuitBreaker = await runCircuitBreaker(batch.payment_failures);
  const rng = createRng(PROMISE_TRACKER_RNG_SEED);

  // PF and CA: every customer_id in the seed is unique within its type (no
  // record's audit history can affect another's Rule 2/3 evaluation), so
  // these are safe to process with bounded concurrency — see the comment on
  // mapWithConcurrency above for why this exists.
  const pfCases = await mapWithConcurrency(batch.payment_failures, RECORD_CONCURRENCY, async (r): Promise<BatchCaseResult> => {
    if (circuitBreaker.pausedRecordIds.has(r.id)) {
      return {
        caseId: r.id,
        customerId: r.customer_id,
        recordType: "circuit_breaker_paused",
        rootCause: "PAUSED_CIRCUIT_BREAKER",
        diagnosisConfidence: 0,
        diagnosisSource: "circuit_breaker",
        needsHumanReview: false,
        pausedByCircuitBreaker: true,
        actions: [],
        naiveActions: [],
      };
    }
    return processPaymentFailure(r);
  });

  const caCases = await mapWithConcurrency(batch.checkout_abandonments, RECORD_CONCURRENCY, (r) => processCheckoutAbandonment(r));

  // B2B stays strictly sequential: business_name is NOT unique in the seed
  // (a real collision, not a hypothetical one — see the comment above), so
  // one record's audit history can genuinely affect another's Rule 2/3
  // evaluation, and runPromiseLifecycle threads one shared, stateful RNG
  // through every record in order — both would break under concurrency.
  const b2bCases: BatchCaseResult[] = [];
  for (const r of batch.b2b_receivables) {
    b2bCases.push(await processB2BReceivable(r, now, rng));
  }

  return { circuitBreaker, cases: [...pfCases, ...caCases, ...b2bCases] };
}
