// lib/classifier/checkout-abandonment.ts — rule-based decision tree for
// checkout abandonment, checked in priority order. Based on
// time_on_payment_page_sec, sessions_count, and payment_method_attempted, per
// BUILD_MANUAL.md Phase 5.1.
import type { CheckoutAbandonment } from "@/data/seed/schema";
import type { ClassificationResult, CheckoutAbandonmentRootCause } from "./types";

export function classifyCheckoutAbandonment(
  record: CheckoutAbandonment
): ClassificationResult<CheckoutAbandonmentRootCause> {
  const { time_on_payment_page_sec: timeOnPage, sessions_count: sessions, payment_method_attempted: method, cart_value_inr: cartValue } = record;

  if (method !== null && timeOnPage > 60) {
    return {
      rootCause: "TECHNICAL_ERROR",
      confidence: 0.85,
      reasoning: `Customer actively attempted ${method} and stayed ${timeOnPage}s — spent real effort, so the payment likely failed technically rather than the customer changing their mind.`,
      source: "rule_based",
    };
  }
  if (sessions >= 3 && cartValue > 3000) {
    return {
      rootCause: "PRICE_SENSITIVITY",
      confidence: 0.7,
      reasoning: `${sessions} separate sessions on a ₹${cartValue} cart suggests repeated hesitation over price, not a one-off distraction.`,
      source: "rule_based",
    };
  }
  if (method === null && timeOnPage < 20) {
    return {
      rootCause: "COMPARISON_SHOPPING",
      confidence: 0.6,
      reasoning: `Left in ${timeOnPage}s without attempting any payment method — consistent with browsing/comparing rather than an intent to buy right now.`,
      source: "rule_based",
    };
  }
  if (sessions === 1 && timeOnPage < 30) {
    return {
      rootCause: "TRUST_SIGNAL_GAP",
      confidence: 0.55,
      reasoning: "A single, very short session with no return visit is consistent with the customer losing confidence at the payment step.",
      source: "rule_based",
    };
  }
  if (method !== null) {
    return {
      rootCause: "PAYMENT_METHOD_FRICTION",
      confidence: 0.5,
      reasoning: `Attempted ${method} but didn't complete — some friction in that specific payment method's flow.`,
      source: "rule_based",
    };
  }
  return {
    rootCause: "PRICE_SENSITIVITY",
    confidence: 0.3,
    reasoning: "No signal combination matched a confident rule — escalating to the AI fallback for a closer read of this session's pattern.",
    source: "rule_based",
  };
}
