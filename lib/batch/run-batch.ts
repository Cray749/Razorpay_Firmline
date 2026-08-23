// lib/batch/run-batch.ts — the core pipeline: circuit breaker -> diagnosis ->
// decision -> promise tracker -> compliance gate, for every record in a
// batch. This is what app/api/batch/route.ts calls. Execution (message
// generation, dispatch, Rule 9) is layered on top in Phase 9 — this module
// stops at "here is the gate's verdict for every proposed action," which is
// also exactly what Phase 8's own Definition of Done needs to verify against
// the real seeded batch.
import type { SeedBatch, PaymentFailure, CheckoutAbandonment, B2BReceivable } from "@/data/seed/schema";
import type { ProposedAction, RecordType } from "@/lib/actions/types";
import { runCircuitBreaker, type CircuitBreakerOutcome } from "@/lib/circuit-breaker/index";
import { diagnosePaymentFailure, diagnoseCheckoutAbandonment, diagnoseB2BReceivable } from "@/lib/classifier/claude-fallback";
import { decidePaymentFailureActions, decideCheckoutAbandonmentActions, decideB2BReceivableActions } from "@/lib/actions/decision-table";
import { applyPromiseTrackerOverrides, runPromiseLifecycle } from "@/lib/promise-tracker/state-machine";
import { buildCustomerContext, type ContextBaselineInput } from "@/lib/rules/context";
import { runComplianceGate, type GateResult } from "@/lib/rules/gate";
import { createRng } from "@/data/seed/rng";

export type BatchActionOutcome = {
  proposedAction: ProposedAction;
  gateResult: GateResult;
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
};

export type BatchResult = {
  circuitBreaker: CircuitBreakerOutcome;
  cases: BatchCaseResult[];
};

const PROMISE_TRACKER_RNG_SEED = 20260810 + 1; // distinct from the data-generator seed, still fixed/reproducible

async function processActions(
  actions: ProposedAction[],
  baseline: ContextBaselineInput
): Promise<BatchActionOutcome[]> {
  const overridden = applyPromiseTrackerOverrides(actions);
  const outcomes: BatchActionOutcome[] = [];
  for (const action of overridden) {
    const context = await buildCustomerContext(baseline, action);
    const gateResult = await runComplianceGate(action, context);
    outcomes.push({ proposedAction: action, gateResult });
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
  const outcomes = await processActions(actions, baseline);
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
  const outcomes = await processActions(actions, baseline);
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

  const outcomes = await processActions(actions, baseline);
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
  };
}

export async function runBatchPipeline(batch: SeedBatch, now: Date = new Date()): Promise<BatchResult> {
  const circuitBreaker = await runCircuitBreaker(batch.payment_failures);
  const rng = createRng(PROMISE_TRACKER_RNG_SEED);
  const cases: BatchCaseResult[] = [];

  for (const r of batch.payment_failures) {
    if (circuitBreaker.pausedRecordIds.has(r.id)) {
      cases.push({
        caseId: r.id,
        customerId: r.customer_id,
        recordType: "circuit_breaker_paused",
        rootCause: "PAUSED_CIRCUIT_BREAKER",
        diagnosisConfidence: 0,
        diagnosisSource: "circuit_breaker",
        needsHumanReview: false,
        pausedByCircuitBreaker: true,
        actions: [],
      });
      continue;
    }
    cases.push(await processPaymentFailure(r));
  }

  for (const r of batch.checkout_abandonments) {
    cases.push(await processCheckoutAbandonment(r));
  }

  for (const r of batch.b2b_receivables) {
    cases.push(await processB2BReceivable(r, now, rng));
  }

  return { circuitBreaker, cases };
}
