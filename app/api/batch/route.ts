// app/api/batch/route.ts — runs the full Firmline pipeline (circuit breaker
// -> diagnosis -> decision -> promise tracker -> compliance gate -> execution)
// against the seeded batch, persists the results, and returns a summary.
import { NextResponse } from "next/server";
import seedBatchJson from "@/data/seed/seeds/seed-v1.json";
import type { SeedBatch } from "@/data/seed/schema";
import { runBatchPipeline } from "@/lib/batch/run-batch";
import { saveBatchRun, loadLatestBatchRun } from "@/lib/db/case-results";
import { computeAuditDerivedMetrics } from "@/lib/metrics/dashboard";
import { flushAuditLog } from "@/lib/audit/log";

// Batch runs can involve real Gemini/Razorpay calls for up to ~200 records;
// give this route the most runtime Vercel allows on the Hobby tier.
export const maxDuration = 60;

export async function POST() {
  const batch = seedBatchJson as SeedBatch;
  const startedAt = Date.now();
  const result = await runBatchPipeline(batch);
  // Audit log writes are buffered and flushed in batches in the background
  // during the run (see lib/audit/log.ts) — this makes sure every last one
  // actually lands in Supabase before the response goes out, since
  // unawaited work isn't guaranteed to run after a serverless function returns.
  await flushAuditLog();
  const stored = await saveBatchRun(result.cases);
  const latencyMs = Date.now() - startedAt;

  return NextResponse.json({
    batchRunId: stored.batchRunId,
    createdAt: stored.createdAt,
    latencyMs,
    totalCases: result.cases.length,
    circuitBreakerTrips: result.circuitBreaker.trips,
    pausedCount: result.circuitBreaker.pausedRecordIds.size,
  });
}

export async function GET() {
  const stored = await loadLatestBatchRun();
  if (!stored) {
    const batch = seedBatchJson as SeedBatch;
    const seedSize = batch.payment_failures.length + batch.checkout_abandonments.length + batch.b2b_receivables.length;
    return NextResponse.json({ hasRun: false, seedSize });
  }
  const auditMetrics = await computeAuditDerivedMetrics();
  return NextResponse.json({ hasRun: true, ...stored, auditMetrics });
}
