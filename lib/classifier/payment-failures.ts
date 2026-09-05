// lib/classifier/payment-failures.ts — rule-based decision tree, checked in
// this EXACT priority order (BUILD_MANUAL.md Phase 5.1). Order matters:
// several conditions overlap (e.g. a RISK_DECLINED failure that also landed
// outside the NPCI non-peak window is classified as a timing violation first,
// because fixing the timing is the more actionable, more certain cause).
import type { PaymentFailure } from "@/data/seed/schema";
import { isWithinNpciNonPeakWindow } from "@/lib/time/ist";
import type { ClassificationResult, PaymentFailureRootCause } from "./types";

export function classifyPaymentFailure(record: PaymentFailure): ClassificationResult<PaymentFailureRootCause> {
  const attemptedAt = new Date(record.attempted_at);
  const mandateExpiry = new Date(record.mandate_expiry);

  if (record.is_disputed) {
    return {
      rootCause: "NEEDS_HUMAN_REVIEW",
      confidence: 0.95,
      reasoning: "Customer has an open dispute on this charge — never auto-diagnose a disputed case, it goes straight to a human.",
      source: "rule_based",
    };
  }
  if (record.failure_code === "INSUFFICIENT_FUNDS") {
    return {
      rootCause: "INSUFFICIENT_BALANCE",
      confidence: 0.9,
      reasoning: "Gateway reported INSUFFICIENT_FUNDS directly — the account balance was too low at the moment of the attempt.",
      source: "rule_based",
    };
  }
  if (!isWithinNpciNonPeakWindow(attemptedAt)) {
    return {
      rootCause: "MANDATE_TIMING_VIOLATION",
      confidence: 0.9,
      reasoning: "The retry attempt fell inside an NPCI peak window, which AutoPay debit retries are not permitted to run in.",
      source: "rule_based",
    };
  }
  if (record.previous_attempts_today >= 1) {
    return {
      rootCause: "MANDATE_TIMING_VIOLATION",
      confidence: 0.9,
      reasoning: `This mandate already had ${record.previous_attempts_today} attempt(s) today — NPCI allows only one charge attempt per mandate per day.`,
      source: "rule_based",
    };
  }
  if (record.failure_code === "MANDATE_EXPIRED" || mandateExpiry < attemptedAt) {
    return {
      rootCause: "MANDATE_EXPIRED_OR_REVOKED",
      confidence: 0.9,
      reasoning: "The mandate had expired (or was reported expired) by the time this attempt ran — retrying won't help, a new mandate is needed.",
      source: "rule_based",
    };
  }
  if (record.failure_code === "RISK_DECLINED") {
    return {
      rootCause: "BANK_RISK_DECLINE",
      confidence: 0.9,
      reasoning: "The issuing bank's risk engine declined the transaction — this needs human judgment, not an automated retry.",
      source: "rule_based",
    };
  }
  if (record.failure_code === "PIN_INCORRECT") {
    return {
      rootCause: "INCORRECT_CREDENTIALS",
      confidence: 0.9,
      reasoning: "The customer entered an incorrect PIN/credential — a reminder to retry with correct credentials is the right response.",
      source: "rule_based",
    };
  }
  if (record.failure_code === "GATEWAY_TIMEOUT") {
    return {
      rootCause: "RAIL_OUTAGE",
      confidence: 0.5,
      reasoning: "Gateway timeout — plausibly a rail-side outage rather than anything customer-specific, but not certain from this signal alone.",
      source: "rule_based",
    };
  }
  return {
    rootCause: "GATEWAY_TECHNICAL_ERROR",
    confidence: 0.3,
    reasoning: `Failure code "${record.failure_code}" doesn't map cleanly to a known cause — escalating to the AI fallback for a closer read.`,
    source: "rule_based",
  };
}
