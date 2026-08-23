// lib/actions/decision-table.ts — a LOOKUP TABLE, not a generator (BUILD_MANUAL.md
// Phase 6). Every root cause maps to a fixed default action (or two). The agent
// never invents an action here.
import type { PaymentFailure, CheckoutAbandonment, B2BReceivable } from "@/data/seed/schema";
import type { ActionType, ContactTarget, ProposedAction, RecordType } from "./types";

const DECISION_TABLE: Record<string, ActionType[]> = {
  // Payment failures
  INSUFFICIENT_BALANCE: ["SCHEDULE_COMPLIANT_RETRY", "SEND_SOFT_REMINDER"],
  MANDATE_TIMING_VIOLATION: ["SCHEDULE_COMPLIANT_RETRY"],
  MANDATE_EXPIRED_OR_REVOKED: ["REQUEST_NEW_PAYMENT_METHOD"],
  CARD_EXPIRED: ["REQUEST_NEW_PAYMENT_METHOD"],
  BANK_RISK_DECLINE: ["ESCALATE_TO_HUMAN"],
  RAIL_OUTAGE: ["SILENT_RETRY_LATER"],
  INCORRECT_CREDENTIALS: ["SEND_SOFT_REMINDER"],
  GATEWAY_TECHNICAL_ERROR: ["SILENT_RETRY_LATER"],
  // Checkout abandonment
  PRICE_SENSITIVITY: ["OFFER_APPROVED_DISCOUNT"],
  PAYMENT_METHOD_FRICTION: ["SEND_SOFT_REMINDER", "GENERATE_PAYMENT_LINK"],
  TRUST_SIGNAL_GAP: ["SEND_SOFT_REMINDER"], // no discount — a discount doesn't fix a trust problem
  TECHNICAL_ERROR: ["GENERATE_PAYMENT_LINK"],
  COMPARISON_SHOPPING: ["NO_ACTION_NEEDED"],
  // B2B receivables
  CASH_FLOW_DELAY: ["OFFER_PAYMENT_PLAN", "CAPTURE_PROMISE_TO_PAY"],
  INVOICE_DISPUTE: ["ESCALATE_TO_HUMAN"],
  OVERSIGHT: ["SEND_SOFT_REMINDER"],
  APPROVAL_CHAIN_DELAY: ["CAPTURE_PROMISE_TO_PAY"],
  // Shared
  NEEDS_HUMAN_REVIEW: ["ESCALATE_TO_HUMAN"],
};

/** Retry-type actions the Decision layer must proactively stop-loss-check
 * before proposing — see checkStopLossProactively below. */
const RETRY_ACTION_TYPES: ActionType[] = ["SCHEDULE_COMPLIANT_RETRY", "SILENT_RETRY_LATER"];

export const STOP_LOSS_THRESHOLD = 5; // must match lib/rules/11-stop-loss.ts exactly

/**
 * Proactively substitutes a retry-type action when the record has already hit
 * the stop-loss threshold — don't propose an action the gate will only reject
 * anyway (Phase 6: "a 'proposed but immediately blocked' entry reads worse
 * than a 'correctly never proposed' one"). High-value customers get escalated
 * to a human rather than written off outright.
 */
function checkStopLossProactively(
  actionTypes: ActionType[],
  previousAttemptsTotal21d: number,
  isHighValue: boolean
): ActionType[] {
  const hasRetry = actionTypes.some((a) => RETRY_ACTION_TYPES.includes(a));
  if (!hasRetry || previousAttemptsTotal21d < STOP_LOSS_THRESHOLD) {
    return actionTypes;
  }
  const substitute: ActionType = isHighValue ? "ESCALATE_TO_HUMAN" : "STOP_AND_WRITE_OFF";
  const kept = actionTypes.filter((a) => !RETRY_ACTION_TYPES.includes(a));
  return kept.includes(substitute) ? kept : [...kept, substitute];
}

// A small, deterministic subset of payment failures deliberately get a
// mismatched contact target (an address that does NOT match the record's
// verified customer_phone/customer_email), simulating a real-world data-
// quality slip where the system tries to reach a secondary/incorrect contact.
// This exists purely so Rule 5 (verified-contact-only) has real, deterministic
// content to catch in the batch run — see BUILD_MANUAL.md Phase 3's edge-case
// table ("contact channel mismatched from verified contact | 5 | Rule 5").
export function isContactMismatchDemoCase(id: string): boolean {
  const n = parseInt(id.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n % 17 === 4;
}

function resolvePfContactTarget(record: PaymentFailure): ContactTarget {
  if (isContactMismatchDemoCase(record.id)) {
    return { channel: "email", address: `alt-contact-${record.id}@example.com` };
  }
  return { channel: "whatsapp", address: record.customer_phone };
}

function resolveCaContactTarget(record: CheckoutAbandonment): ContactTarget {
  return { channel: "whatsapp", address: record.customer_phone };
}

function resolveB2bContactTarget(record: B2BReceivable): ContactTarget {
  return { channel: "email", address: record.contact_email };
}

function buildActions(
  actionTypes: ActionType[],
  base: Omit<ProposedAction, "actionType">
): ProposedAction[] {
  return actionTypes.map((actionType) => {
    const noContact: ActionType[] = ["NO_ACTION_NEEDED", "STOP_AND_WRITE_OFF"];
    return {
      ...base,
      actionType,
      contactTarget: noContact.includes(actionType) ? null : base.contactTarget,
    };
  });
}

export function decidePaymentFailureActions(record: PaymentFailure, rootCause: string): ProposedAction[] {
  const table = DECISION_TABLE[rootCause] ?? ["ESCALATE_TO_HUMAN"];
  const actionTypes = checkStopLossProactively(table, record.previous_attempts_total_21d, record.customer_segment === "high_value");
  const recordType: RecordType = "payment_failure";
  const contactTarget = resolvePfContactTarget(record);
  const proposedAt = new Date(record.attempted_at);

  return buildActions(actionTypes, {
    caseId: record.id,
    customerId: record.customer_id,
    recordType,
    rootCause,
    contactTarget,
    proposedAt,
    mandateId: record.mandate_id,
  });
}

export function decideCheckoutAbandonmentActions(record: CheckoutAbandonment, rootCause: string): ProposedAction[] {
  const table = DECISION_TABLE[rootCause] ?? ["ESCALATE_TO_HUMAN"];
  const recordType: RecordType = "checkout_abandonment";
  const contactTarget = resolveCaContactTarget(record);
  const proposedAt = new Date(record.abandoned_at);

  const actions = buildActions(table, {
    caseId: record.id,
    customerId: record.customer_id,
    recordType,
    rootCause,
    contactTarget,
    proposedAt,
  });

  if (rootCause === "PRICE_SENSITIVITY") {
    for (const a of actions) {
      if (a.actionType === "OFFER_APPROVED_DISCOUNT") {
        a.discountPercent = isDiscountOverreachDemoCase(record.id)
          ? defaultDiscountForSegment(record.customer_segment) + 20 // deliberately outside the band
          : defaultDiscountForSegment(record.customer_segment);
      }
    }
  }
  return actions;
}

// A small, deterministic subset of checkout-abandonment records deliberately
// gets an over-generous discount offer, outside its segment's approved band —
// simulating a naive "just give a bigger discount" impulse a less disciplined
// agent might have. This exists purely so Rule 10 (discount fairness) has
// real, deterministic content to catch in the batch run, and doubles as a
// clean example for the counterfactual view (Phase 12): the naive agent sends
// it, Firmline blocks it.
export function isDiscountOverreachDemoCase(id: string): boolean {
  const n = parseInt(id.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n % 11 === 3;
}

export function decideB2BReceivableActions(record: B2BReceivable, rootCause: string, now: Date = new Date()): ProposedAction[] {
  const table = DECISION_TABLE[rootCause] ?? ["ESCALATE_TO_HUMAN"];
  const recordType: RecordType = "b2b_receivable";
  const contactTarget = resolveB2bContactTarget(record);

  return buildActions(table, {
    caseId: record.id,
    customerId: record.business_name,
    recordType,
    rootCause,
    contactTarget,
    proposedAt: now,
  });
}

/** Midpoint of each segment's discount band (Rule 10 enforces the actual
 * bounds; this just proposes a reasonable starting offer within them). */
function defaultDiscountForSegment(segment: PaymentFailure["customer_segment"] | CheckoutAbandonment["customer_segment"]): number {
  switch (segment) {
    case "standard":
      return 3;
    case "at_risk":
      return 10;
    case "high_value":
      return 7;
    default:
      return 3;
  }
}
