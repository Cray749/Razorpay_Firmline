// lib/actions/types.ts — the fixed, bounded action library (README.md "The
// bounded action library"). The agent selects from this list only; it never
// writes a new action type at runtime.
export const ACTION_TYPES = [
  "SILENT_RETRY_LATER",
  "SCHEDULE_COMPLIANT_RETRY",
  "SEND_SOFT_REMINDER",
  "SEND_PRE_DEBIT_NOTICE_THEN_RETRY",
  "OFFER_APPROVED_DISCOUNT",
  "REQUEST_NEW_PAYMENT_METHOD",
  "GENERATE_PAYMENT_LINK",
  "OFFER_PAYMENT_PLAN",
  "CAPTURE_PROMISE_TO_PAY",
  "ESCALATE_TO_HUMAN",
  "STOP_AND_WRITE_OFF",
  "NO_ACTION_NEEDED",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Actions that involve retrying a mandate charge — these are the ones the
 * Decision layer must proactively stop-loss-check before proposing (Phase 6),
 * and the ones Rule 6 (pre-debit notice) and Rule 8 (NPCI window) apply to. */
export const MANDATE_RETRY_ACTION_TYPES: ActionType[] = ["SCHEDULE_COMPLIANT_RETRY", "SEND_PRE_DEBIT_NOTICE_THEN_RETRY"];

export type RecordType = "payment_failure" | "checkout_abandonment" | "b2b_receivable";
export type Channel = "whatsapp" | "sms" | "email" | "voice";

export type ContactTarget = {
  channel: Channel;
  address: string;
};

export type ProposedAction = {
  actionType: ActionType;
  caseId: string;
  customerId: string;
  recordType: RecordType;
  rootCause: string;
  /** null when the action has no direct customer contact (NO_ACTION_NEEDED,
   * STOP_AND_WRITE_OFF, or internal escalation with no outbound message). */
  contactTarget: ContactTarget | null;
  /** When this action would run — feeds Rule 1 (contact window) and Rule 8
   * (NPCI window). Defaults to the record's own event time; Rule 6 may
   * overwrite this via rescheduleTo when a pre-debit notice is missing. */
  proposedAt: Date;
  mandateId?: string;
  discountPercent?: number;
  metadata?: Record<string, unknown>;
};
