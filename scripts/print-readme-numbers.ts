// scripts/print-readme-numbers.ts — one-off: runs a fresh batch and prints
// every number the README's "What we measured" table needs, so they can be
// copy-pasted exactly rather than transcribed from the UI by hand.
import seedBatchJson from "@/data/seed/seeds/seed-v1.json";
import type { SeedBatch } from "@/data/seed/schema";
import { runBatchPipeline } from "@/lib/batch/run-batch";
import { computeDashboardMetrics, computeAuditDerivedMetrics } from "@/lib/metrics/dashboard";
import { SEED_VERSION_LABEL, SEED_VALUE } from "@/data/seed/constants";
import diagnosisAccuracy from "@/docs/metrics/diagnosis_accuracy.json";

async function main() {
  const batch = seedBatchJson as SeedBatch;
  const result = await runBatchPipeline(batch);
  const metrics = computeDashboardMetrics(result.cases);
  const auditMetrics = await computeAuditDerivedMetrics();

  const ruleFireTotal = Object.values(metrics.complianceRuleFireCounts).reduce((a, b) => a + b, 0);
  const rulesFiredCount = Object.values(metrics.complianceRuleFireCounts).filter((v) => v > 0).length;

  console.log(JSON.stringify({
    seedVersion: SEED_VERSION_LABEL,
    seedValue: SEED_VALUE,
    batchSize: batch.payment_failures.length + batch.checkout_abandonments.length + batch.b2b_receivables.length,
    pfCount: batch.payment_failures.length,
    caCount: batch.checkout_abandonments.length,
    b2bCount: batch.b2b_receivables.length,
    ...metrics,
    ruleFireTotal,
    rulesFiredCount,
    circuitBreakerTripCount: auditMetrics.circuitBreakerTripCount,
    promiseFulfilledCount: auditMetrics.promiseFulfilledCount,
    promiseBrokenCount: auditMetrics.promiseBrokenCount,
    promiseFulfillmentRatePercent: auditMetrics.promiseFulfillmentRatePercent,
    diagnosisOverallAccuracy: diagnosisAccuracy.overall_accuracy,
    diagnosisTotalRecords: diagnosisAccuracy.total_records_diagnosed,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
