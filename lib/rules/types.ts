// lib/rules/types.ts — the shared shape every one of the 13 compliance rules
// implements. BUILD_MANUAL.md Phase 8.2: "Every rule is a pure function."
// Pure means synchronous and side-effect-free — no I/O inside a rule. All the
// I/O (querying the audit log, building history) happens once, up front, in
// lib/rules/context.ts, producing a CustomerContext that rules just read.
import type { ProposedAction, Channel } from "@/lib/actions/types";

export type RuleResult = {
  allowed: boolean;
  reason: string;
  rescheduleTo?: Date;
};

export type ComplianceRule = (action: ProposedAction, context: CustomerContext) => RuleResult;

export type CustomerContext = {
  customerId: string;
  isOptedOut: boolean;
  isDisputed: boolean;
  customerSegment: "standard" | "at_risk" | "high_value" | null;
  lastContactStatus: "DELIVERED" | "FAILED_INVALID_NUMBER" | "NO_PRIOR_CONTACT";
  previousAttemptsTotal21d: number;
  verifiedPhone: string | null;
  verifiedEmail: string | null;

  // Audit-log-derived (built by lib/rules/context.ts from the real audit log,
  // including a documented backfill of the record's own baseline counters —
  // see buildCustomerContext for exactly how).
  /** Contacts (any channel) to this customer in the trailing 24h before proposedAt. */
  contactsTrailing24h: number;
  /** Contacts (any channel) to this customer in the trailing 7 days before proposedAt. */
  contactsTrailing7d: number;
  /** Most recent contact to this customer, any channel, before proposedAt (null if none). */
  lastContactAt: Date | null;
  /** When a pre-debit notice was last sent for this action's mandate_id (null if never). */
  preDebitNoticeSentAt: Date | null;
  /** Whether this action's mandate_id already had a charge attempt on the same IST calendar day as proposedAt. */
  mandateChargeAttemptedTodayOnMandate: boolean;
};

/** Discount fairness bands (Rule 10), keyed to customer segment. Percentages
 * are inclusive on both ends. */
export const DISCOUNT_BANDS: Record<NonNullable<CustomerContext["customerSegment"]>, { min: number; max: number }> = {
  standard: { min: 0, max: 5 },
  at_risk: { min: 5, max: 15 },
  high_value: { min: 5, max: 10 },
};

export const CHANNELS: Channel[] = ["whatsapp", "sms", "email", "voice"];

/** Shared test-case shape every rule file's exported `testCases` array uses
 * (BUILD_MANUAL.md Phase 8.1's shared harness). */
export type RuleTestCase = {
  name: string;
  action: ProposedAction;
  context: CustomerContext;
  expectAllowed: boolean;
  expectReasonContains?: string;
};
