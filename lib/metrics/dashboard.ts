// lib/metrics/dashboard.ts — computes every dashboard number from the real
// batch result. Nothing here is hardcoded: every figure is a query or a
// computation over case_results + the resolution simulation.
import type { BatchCaseResult } from "@/lib/batch/run-batch";
import type { Channel } from "@/lib/actions/types";
import { findSeedRecord } from "@/lib/ui/find-seed-record";
import { rollResolved, isSimulatable } from "./resolution-simulation";
import { queryAllAuditLog } from "@/lib/audit/log";

// Per-action-cost assumption, documented rather than precise (BUILD_MANUAL.md
// Phase 11: "the point is that it's a real, documented number, not that it's
// precisely accurate").
export const CHANNEL_COST_INR: Record<Channel, number> = { whatsapp: 2, sms: 0.5, email: 0.1, voice: 5 };

function amountForCase(caseId: string): number {
  const lookup = findSeedRecord(caseId);
  if (!lookup) return 0;
  if (lookup.recordType === "payment_failure") return lookup.record.amount_inr;
  if (lookup.recordType === "checkout_abandonment") return lookup.record.cart_value_inr;
  return lookup.record.invoice_amount_inr;
}

export type DashboardMetrics = {
  totalRevenueAtRiskInr: number;
  grossRecoveredInr: number;
  totalDiscountsIssuedInr: number;
  totalActionCostInr: number;
  netRecoveredYieldInr: number;
  recoveryRatePercent: number;
  circuitBreakerPausedCount: number;
  needsHumanReviewCount: number;
  complianceRuleFireCounts: Record<string, number>;
  totalComplianceChecks: number;
  humanReviewQueueCount: number;
  falsePositiveCostInr: number;
  falsePositiveCount: number;
};

export function computeDashboardMetrics(cases: BatchCaseResult[]): DashboardMetrics {
  let totalRevenueAtRiskInr = 0;
  let grossRecoveredInr = 0;
  let totalDiscountsIssuedInr = 0;
  let totalActionCostInr = 0;
  const complianceRuleFireCounts: Record<string, number> = {};
  let totalComplianceChecks = 0;
  let humanReviewQueueCount = 0;
  let falsePositiveCostInr = 0;
  let falsePositiveCount = 0;

  for (const c of cases) {
    const amount = amountForCase(c.caseId);
    totalRevenueAtRiskInr += amount;

    const lookup = findSeedRecord(c.caseId);
    const trueRootCause = lookup?.record.true_root_cause;
    const isFalsePositive = c.diagnosisConfidence < 0.5 && trueRootCause !== undefined && trueRootCause !== c.rootCause;
    if (isFalsePositive) falsePositiveCount++;

    for (const a of c.actions) {
      for (const rule of a.gateResult.allResults) {
        complianceRuleFireCounts[rule.ruleName] = (complianceRuleFireCounts[rule.ruleName] ?? 0) + (rule.allowed ? 0 : 1);
        totalComplianceChecks++;
      }
      if (!a.gateResult.allowed) continue;
      if (!a.execution?.dispatched) {
        if (a.execution?.message && !a.execution.message.toneCheckAllowed) humanReviewQueueCount++;
        continue;
      }

      const channel = a.proposedAction.contactTarget?.channel;
      if (channel && a.execution.message) {
        const cost = CHANNEL_COST_INR[channel];
        totalActionCostInr += cost;
        if (isFalsePositive) falsePositiveCostInr += cost;
      }

      if (!isSimulatable(a.proposedAction.actionType)) continue;
      const resolved = rollResolved(c.caseId, a.proposedAction.actionType, c.rootCause);
      if (resolved) {
        grossRecoveredInr += amount;
        if (a.proposedAction.actionType === "OFFER_APPROVED_DISCOUNT" && a.proposedAction.discountPercent) {
          totalDiscountsIssuedInr += (amount * a.proposedAction.discountPercent) / 100;
        }
      }
    }
  }

  const netRecoveredYieldInr = grossRecoveredInr - totalDiscountsIssuedInr - totalActionCostInr;
  const recoveryRatePercent = totalRevenueAtRiskInr > 0 ? (grossRecoveredInr / totalRevenueAtRiskInr) * 100 : 0;

  return {
    totalRevenueAtRiskInr: round2(totalRevenueAtRiskInr),
    grossRecoveredInr: round2(grossRecoveredInr),
    totalDiscountsIssuedInr: round2(totalDiscountsIssuedInr),
    totalActionCostInr: round2(totalActionCostInr),
    netRecoveredYieldInr: round2(netRecoveredYieldInr),
    recoveryRatePercent: round2(recoveryRatePercent),
    circuitBreakerPausedCount: cases.filter((c) => c.pausedByCircuitBreaker).length,
    needsHumanReviewCount: cases.filter((c) => c.needsHumanReview).length,
    complianceRuleFireCounts,
    totalComplianceChecks,
    humanReviewQueueCount,
    falsePositiveCostInr: round2(falsePositiveCostInr),
    falsePositiveCount,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type AuditDerivedMetrics = {
  circuitBreakerTripCount: number;
  promiseFulfilledCount: number;
  promiseBrokenCount: number;
  promiseFulfillmentRatePercent: number;
};

export async function computeAuditDerivedMetrics(): Promise<AuditDerivedMetrics> {
  const rows = await queryAllAuditLog();
  const circuitBreakerTripCount = rows.filter((r) => r.event_type === "circuit_breaker_tripped").length;
  const promiseFulfilledCount = rows.filter((r) => r.event_type === "promise_fulfilled").length;
  const promiseBrokenCount = rows.filter((r) => r.event_type === "promise_broken").length;
  const totalPromises = promiseFulfilledCount + promiseBrokenCount;
  const promiseFulfillmentRatePercent = totalPromises > 0 ? round2((promiseFulfilledCount / totalPromises) * 100) : 0;
  return { circuitBreakerTripCount, promiseFulfilledCount, promiseBrokenCount, promiseFulfillmentRatePercent };
}
