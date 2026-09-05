// scripts/measure-diagnosis-accuracy.ts — runs every classifier over the full
// seeded batch, compares against true_root_cause (never shown to the
// classifiers themselves), and writes real precision/recall per category to
// docs/metrics/diagnosis_accuracy.json. Run with `npm run measure:diagnosis`.
//
// Records paused by the circuit breaker are excluded, per BUILD_MANUAL.md
// Phase 5's Definition of Done ("every record in the batch, except records
// paused by the circuit breaker, receives a root cause label").
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import seedBatchJson from "@/data/seed/seeds/seed-v1.json";
import type { SeedBatch } from "@/data/seed/schema";
import { runCircuitBreaker } from "@/lib/circuit-breaker/index";
import { diagnosePaymentFailure, diagnoseCheckoutAbandonment, diagnoseB2BReceivable } from "@/lib/classifier/ai-fallback";
import { SEED_VERSION_LABEL } from "@/data/seed/constants";

const batch = seedBatchJson as SeedBatch;

type Sample = { trueLabel: string; predictedLabel: string; source: string; needsHumanReview: boolean };

async function main() {
  const cb = await runCircuitBreaker(batch.payment_failures);
  const pfRecords = batch.payment_failures.filter((r) => !cb.pausedRecordIds.has(r.id));

  const samples: Sample[] = [];

  console.log(`Diagnosing ${pfRecords.length} payment failures (${cb.pausedRecordIds.size} paused by circuit breaker, excluded)...`);
  for (const r of pfRecords) {
    const result = await diagnosePaymentFailure(r);
    samples.push({ trueLabel: r.true_root_cause, predictedLabel: result.rootCause, source: result.source, needsHumanReview: !!result.needsHumanReview });
  }

  console.log(`Diagnosing ${batch.checkout_abandonments.length} checkout abandonments...`);
  for (const r of batch.checkout_abandonments) {
    const result = await diagnoseCheckoutAbandonment(r);
    samples.push({ trueLabel: r.true_root_cause, predictedLabel: result.rootCause, source: result.source, needsHumanReview: !!result.needsHumanReview });
  }

  console.log(`Diagnosing ${batch.b2b_receivables.length} B2B receivables...`);
  for (const r of batch.b2b_receivables) {
    const result = await diagnoseB2BReceivable(r);
    samples.push({ trueLabel: r.true_root_cause, predictedLabel: result.rootCause, source: result.source, needsHumanReview: !!result.needsHumanReview });
  }

  const labels = Array.from(new Set(samples.flatMap((s) => [s.trueLabel, s.predictedLabel]))).sort();
  const perCategory: Record<string, { precision: number; recall: number; support: number; truePositives: number; falsePositives: number; falseNegatives: number }> = {};

  for (const label of labels) {
    const tp = samples.filter((s) => s.trueLabel === label && s.predictedLabel === label).length;
    const fp = samples.filter((s) => s.predictedLabel === label && s.trueLabel !== label).length;
    const fn = samples.filter((s) => s.trueLabel === label && s.predictedLabel !== label).length;
    const support = samples.filter((s) => s.trueLabel === label).length;
    perCategory[label] = {
      precision: tp + fp > 0 ? round(tp / (tp + fp)) : null as unknown as number,
      recall: tp + fn > 0 ? round(tp / (tp + fn)) : null as unknown as number,
      support,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
    };
  }

  const overallCorrect = samples.filter((s) => s.trueLabel === s.predictedLabel).length;
  const overallAccuracy = round(overallCorrect / samples.length);

  const aiFallbackAttempts = samples.filter((s) => s.source === "ai_fallback" || s.source === "ai_fallback_failed").length;
  const aiFallbackSucceeded = samples.filter((s) => s.source === "ai_fallback").length;
  const aiFallbackFailed = samples.filter((s) => s.source === "ai_fallback_failed").length;
  const needsHumanReviewCount = samples.filter((s) => s.needsHumanReview).length;

  const output = {
    seed_version: SEED_VERSION_LABEL,
    measured_at: new Date().toISOString(),
    total_records_diagnosed: samples.length,
    circuit_breaker_excluded_count: cb.pausedRecordIds.size,
    overall_accuracy: overallAccuracy,
    ai_fallback: {
      provider: "gemini",
      attempts: aiFallbackAttempts,
      succeeded: aiFallbackSucceeded,
      failed_and_flagged_for_human_review: aiFallbackFailed,
      // Always present (never omitted) so this JSON's shape — and therefore
      // its inferred TypeScript type in app/dashboard/page.tsx — stays stable
      // across runs regardless of whether the fallback succeeded this time.
      note:
        aiFallbackFailed > 0 && aiFallbackSucceeded === 0
          ? "GEMINI_API_KEY was not configured when this was measured — every fallback attempt degraded gracefully to the rule-based guess + needs_human_review, per lib/ai/client.ts's contract. Re-run `npm run measure:diagnosis` once credentials are set for the true blended accuracy."
          : null,
    },
    needs_human_review_count: needsHumanReviewCount,
    per_category: perCategory,
  };

  const outDir = path.resolve(__dirname, "..", "docs", "metrics");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "diagnosis_accuracy.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`\nOverall accuracy: ${(overallAccuracy * 100).toFixed(1)}% (${overallCorrect}/${samples.length})`);
  console.log(`AI fallback (Gemini): ${aiFallbackSucceeded} succeeded, ${aiFallbackFailed} failed-and-flagged, out of ${aiFallbackAttempts} attempts`);
  console.log(`Wrote ${outPath}`);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
