// lib/classifier/types.ts — the fixed root-cause taxonomy (README.md's "Root
// cause taxonomy" section) and the shared classification result shape used by
// every classifier (rule-based and AI fallback alike).

export const PAYMENT_FAILURE_ROOT_CAUSES = [
  "INSUFFICIENT_BALANCE",
  "MANDATE_TIMING_VIOLATION",
  "MANDATE_EXPIRED_OR_REVOKED",
  "CARD_EXPIRED",
  "BANK_RISK_DECLINE",
  "RAIL_OUTAGE",
  "INCORRECT_CREDENTIALS",
  "GATEWAY_TECHNICAL_ERROR",
  "NEEDS_HUMAN_REVIEW",
] as const;
export type PaymentFailureRootCause = (typeof PAYMENT_FAILURE_ROOT_CAUSES)[number];

export const CHECKOUT_ABANDONMENT_ROOT_CAUSES = [
  "PRICE_SENSITIVITY",
  "PAYMENT_METHOD_FRICTION",
  "TRUST_SIGNAL_GAP",
  "TECHNICAL_ERROR",
  "COMPARISON_SHOPPING",
] as const;
export type CheckoutAbandonmentRootCause = (typeof CHECKOUT_ABANDONMENT_ROOT_CAUSES)[number];

export const B2B_RECEIVABLE_ROOT_CAUSES = [
  "CASH_FLOW_DELAY",
  "INVOICE_DISPUTE",
  "OVERSIGHT",
  "APPROVAL_CHAIN_DELAY",
] as const;
export type B2BReceivableRootCause = (typeof B2B_RECEIVABLE_ROOT_CAUSES)[number];

export type RootCause = PaymentFailureRootCause | CheckoutAbandonmentRootCause | B2BReceivableRootCause;

/** Below this confidence, the rule-based classification is escalated to the
 * AI fallback (Phase 5.2 of BUILD_MANUAL.md), currently Gemini. */
export const CONFIDENCE_ESCALATION_THRESHOLD = 0.5;

export type ClassificationSource = "rule_based" | "ai_fallback" | "ai_fallback_failed";

export type ClassificationResult<T extends string = RootCause> = {
  rootCause: T;
  confidence: number;
  reasoning: string;
  source: ClassificationSource;
  /** Set when the AI fallback was needed but itself failed (Phase 6.2's
   * contract): the rule-based guess is kept as rootCause, but this flag says
   * "don't trust this label as-is, a human should look." Never true for CA/B2B
   * taxonomies where NEEDS_HUMAN_REVIEW isn't a valid label to substitute in. */
  needsHumanReview?: boolean;
};

export function needsFallback(confidence: number): boolean {
  return confidence < CONFIDENCE_ESCALATION_THRESHOLD;
}
