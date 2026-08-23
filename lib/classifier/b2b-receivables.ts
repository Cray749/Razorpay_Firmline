// lib/classifier/b2b-receivables.ts — rule-based decision tree for overdue
// B2B receivables, based on payment_history_pattern, dispute_flag, and
// days_overdue, per BUILD_MANUAL.md Phase 5.1. The frequently_late/no-dispute
// case is deliberately the sharpest test here: a naive classifier might
// assume "overdue = disputed", but a customer who is reliably late without
// ever disputing is a cash-flow-timing problem, not a disagreement over the
// invoice — treating it as INVOICE_DISPUTE would escalate to a human for
// something that's usually resolvable with a payment plan.
import type { B2BReceivable } from "@/data/seed/schema";
import type { ClassificationResult, B2BReceivableRootCause } from "./types";

export function classifyB2BReceivable(record: B2BReceivable): ClassificationResult<B2BReceivableRootCause> {
  if (record.dispute_flag) {
    return {
      rootCause: "INVOICE_DISPUTE",
      confidence: 0.95,
      reasoning: "Customer has flagged this invoice as disputed — no automated recovery action until a human resolves the dispute.",
      source: "rule_based",
    };
  }
  if (record.payment_history_pattern === "frequently_late") {
    return {
      rootCause: "CASH_FLOW_DELAY",
      confidence: 0.85,
      reasoning: "This customer's history is frequently_late with no dispute raised — a recurring cash-flow timing pattern, not disagreement over the invoice.",
      source: "rule_based",
    };
  }
  if (record.payment_history_pattern === "first_invoice") {
    return {
      rootCause: "OVERSIGHT",
      confidence: 0.6,
      reasoning: "First invoice with this business and no dispute — most likely a simple oversight during onboarding, not a payment-capacity problem.",
      source: "rule_based",
    };
  }
  // always_on_time
  return {
    rootCause: "APPROVAL_CHAIN_DELAY",
    confidence: 0.65,
    reasoning: "An otherwise always-on-time payer being late suggests an internal approval-chain delay on their end, not unwillingness to pay.",
    source: "rule_based",
  };
}
