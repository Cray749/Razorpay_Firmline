// lib/classifier/claude-fallback.ts — orchestrates "run the rule-based
// classifier, escalate to Claude only if confidence is low, log the outcome."
// This is the single entry point the batch pipeline calls for diagnosis; it
// never calls the Anthropic SDK directly (that's lib/claude/client.ts's job
// alone) and never bypasses the confidence threshold.
import type { PaymentFailure, CheckoutAbandonment, B2BReceivable } from "@/data/seed/schema";
import { classifyPaymentFailure } from "./payment-failures";
import { classifyCheckoutAbandonment } from "./checkout-abandonment";
import { classifyB2BReceivable } from "./b2b-receivables";
import { diagnoseFallback, type DiagnoseFallbackParams } from "@/lib/claude/diagnose-fallback";
import {
  needsFallback,
  PAYMENT_FAILURE_ROOT_CAUSES,
  CHECKOUT_ABANDONMENT_ROOT_CAUSES,
  B2B_RECEIVABLE_ROOT_CAUSES,
  type ClassificationResult,
  type PaymentFailureRootCause,
  type CheckoutAbandonmentRootCause,
  type B2BReceivableRootCause,
} from "./types";
import { logAuditEvent } from "@/lib/audit/log";

async function withFallback<T extends string>(
  caseId: string,
  customerId: string,
  ruleResult: ClassificationResult<T>,
  recordType: DiagnoseFallbackParams["recordType"],
  recordSummary: string,
  taxonomy: readonly T[]
): Promise<ClassificationResult<T>> {
  let final: ClassificationResult<T> = ruleResult;

  if (needsFallback(ruleResult.confidence)) {
    const fb = await diagnoseFallback({ recordType, recordSummary, taxonomy, caseId });
    if (fb.success) {
      final = {
        rootCause: fb.rootCause as T,
        confidence: 0.75,
        reasoning: fb.reasoning,
        source: "claude_fallback",
      };
    } else {
      // Phase 6.2's contract: never silently guess. Keep the rule-based guess,
      // flag it, and let a human decide.
      final = {
        ...ruleResult,
        source: "claude_fallback_failed",
        needsHumanReview: true,
        reasoning: `${ruleResult.reasoning} — Claude fallback unavailable (${fb.reason}); flagged for human review rather than guessing.`,
      };
    }
  }

  await logAuditEvent({
    case_id: caseId,
    customer_id: customerId,
    layer: "diagnosis",
    event_type: `diagnosis_${final.source}`,
    reasoning_text: final.reasoning,
    detail: { rootCause: final.rootCause, confidence: final.confidence, needsHumanReview: final.needsHumanReview ?? false },
  });

  return final;
}

export async function diagnosePaymentFailure(record: PaymentFailure): Promise<ClassificationResult<PaymentFailureRootCause>> {
  const rule = classifyPaymentFailure(record);
  const summary = [
    `Amount: Rs ${record.amount_inr}.`,
    `Failure code: ${record.failure_code}.`,
    `Attempted at: ${record.attempted_at}.`,
    `Previous attempts today on this mandate: ${record.previous_attempts_today}.`,
    `Previous attempts in the last 21 days: ${record.previous_attempts_total_21d}.`,
    `Mandate expiry: ${record.mandate_expiry}.`,
    `Last contact status: ${record.last_contact_status}.`,
  ].join(" ");
  return withFallback(record.id, record.customer_id, rule, "payment failure", summary, PAYMENT_FAILURE_ROOT_CAUSES);
}

export async function diagnoseCheckoutAbandonment(
  record: CheckoutAbandonment
): Promise<ClassificationResult<CheckoutAbandonmentRootCause>> {
  const rule = classifyCheckoutAbandonment(record);
  const summary = [
    `Cart value: Rs ${record.cart_value_inr}.`,
    `Time spent on the payment page: ${record.time_on_payment_page_sec} seconds.`,
    `Number of sessions before abandoning: ${record.sessions_count}.`,
    `Payment method attempted: ${record.payment_method_attempted ?? "none"}.`,
    `Abandoned at: ${record.abandoned_at}.`,
  ].join(" ");
  return withFallback(record.id, record.customer_id, rule, "checkout abandonment", summary, CHECKOUT_ABANDONMENT_ROOT_CAUSES);
}

export async function diagnoseB2BReceivable(record: B2BReceivable): Promise<ClassificationResult<B2BReceivableRootCause>> {
  const rule = classifyB2BReceivable(record);
  const summary = [
    `Invoice amount: Rs ${record.invoice_amount_inr}.`,
    `Days overdue: ${record.days_overdue}.`,
    `Payment history pattern: ${record.payment_history_pattern}.`,
    `Dispute flagged: ${record.dispute_flag}.`,
  ].join(" ");
  // B2BReceivable has no separate customer_id field — business_name is the
  // natural per-entity identifier for audit-log grouping (frequency checks etc).
  return withFallback(record.id, record.business_name, rule, "overdue B2B receivable", summary, B2B_RECEIVABLE_ROOT_CAUSES);
}
