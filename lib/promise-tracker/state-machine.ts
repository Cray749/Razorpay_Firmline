// lib/promise-tracker/state-machine.ts — BUILD_MANUAL.md Phase 7.
//
//   PROMISED -> DUE_DATE_PENDING -> FULFILLED (case closed, no further action)
//                                -> BROKEN   (discount eligibility revoked,
//                                             forced to ESCALATE_TO_HUMAN,
//                                             one audit event explaining why)
//
// Any record whose action is CAPTURE_PROMISE_TO_PAY enters this state
// machine. Outcomes are simulated with a FIXED, documented probability tied
// to payment_history_pattern (a customer who is normally always_on_time is
// meaningfully more likely to actually follow through than one who is
// frequently_late) — never left implicit.
import type { Rng } from "@/data/seed/rng";
import { logAuditEvent } from "@/lib/audit/log";
import type { B2BReceivable } from "@/data/seed/schema";
import type { ActionType, ProposedAction } from "@/lib/actions/types";

export type PromiseState = "PROMISED" | "DUE_DATE_PENDING" | "FULFILLED" | "BROKEN";

/** Fixed fulfillment-probability table, keyed to payment_history_pattern.
 * Documented here, not left implicit, per Phase 7's explicit requirement. */
export const PROMISE_FULFILLMENT_PROBABILITY: Record<B2BReceivable["payment_history_pattern"], number> = {
  always_on_time: 0.85,
  first_invoice: 0.6,
  frequently_late: 0.3,
};

export type PromiseOutcome = {
  caseId: string;
  customerId: string;
  finalState: Extract<PromiseState, "FULFILLED" | "BROKEN">;
  discountEligibilityRevoked: boolean;
  forcedNextAction: "ESCALATE_TO_HUMAN" | null;
};

// In-process registry of customers whose most recent promise broke. This is
// what "no longer receive automated soft reminders on subsequent processing"
// and "discount eligibility revoked" mean operationally within a batch run;
// a real deployment would reconstruct this from the audit_log's
// promise_broken events on startup rather than an in-memory set.
const brokenPromiseCustomers = new Set<string>();

export function isDiscountEligibilityRevoked(customerId: string): boolean {
  return brokenPromiseCustomers.has(customerId);
}

export function resetPromiseTrackerForTests(): void {
  brokenPromiseCustomers.clear();
}

export async function runPromiseLifecycle(
  caseId: string,
  customerId: string,
  pattern: B2BReceivable["payment_history_pattern"],
  rng: Rng
): Promise<PromiseOutcome> {
  await logAuditEvent({
    case_id: caseId,
    customer_id: customerId,
    layer: "promise_tracker",
    event_type: "promise_promised",
    reasoning_text: `${customerId} promised to pay this invoice.`,
  });
  await logAuditEvent({
    case_id: caseId,
    customer_id: customerId,
    layer: "promise_tracker",
    event_type: "promise_due_date_pending",
    reasoning_text: "Promise moved to due-date-pending, awaiting resolution.",
  });

  const probability = PROMISE_FULFILLMENT_PROBABILITY[pattern];
  const fulfilled = rng.bool(probability);

  if (fulfilled) {
    await logAuditEvent({
      case_id: caseId,
      customer_id: customerId,
      layer: "promise_tracker",
      event_type: "promise_fulfilled",
      reasoning_text: `Promise fulfilled (payment_history_pattern=${pattern}, fulfillment probability ${probability}) — case closed, no further action.`,
    });
    return { caseId, customerId, finalState: "FULFILLED", discountEligibilityRevoked: false, forcedNextAction: null };
  }

  brokenPromiseCustomers.add(customerId);
  await logAuditEvent({
    case_id: caseId,
    customer_id: customerId,
    layer: "promise_tracker",
    event_type: "promise_broken",
    reasoning_text: `Promise broken (payment_history_pattern=${pattern}, fulfillment probability ${probability}) — discount eligibility revoked for ${customerId} and escalated to a human rather than auto-retrying.`,
  });
  return { caseId, customerId, finalState: "BROKEN", discountEligibilityRevoked: true, forcedNextAction: "ESCALATE_TO_HUMAN" };
}

/** Applied by the batch orchestrator to every proposed action before it
 * reaches the compliance gate: a customer with a broken promise never gets
 * another discount or another soft reminder — both get forced to
 * ESCALATE_TO_HUMAN instead. */
export function applyPromiseTrackerOverrides(actions: ProposedAction[]): ProposedAction[] {
  const SUPPRESSED: ActionType[] = ["OFFER_APPROVED_DISCOUNT", "SEND_SOFT_REMINDER"];
  return actions.map((action) => {
    if (!isDiscountEligibilityRevoked(action.customerId) || !SUPPRESSED.includes(action.actionType)) {
      return action;
    }
    return {
      ...action,
      actionType: "ESCALATE_TO_HUMAN",
      discountPercent: undefined,
      metadata: { ...action.metadata, overriddenBy: "promise_tracker", originalActionType: action.actionType },
    };
  });
}
