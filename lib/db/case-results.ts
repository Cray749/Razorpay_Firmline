// lib/db/case-results.ts — persists and reads back BatchCaseResult rows
// (supabase/schema.sql's case_results table). Falls back to an in-process
// singleton when Supabase isn't configured, so `npm run dev` works fully
// offline for local iteration — see lib/supabase/client.ts's header for why
// that fallback exists and its limits (doesn't survive server restarts or
// multiple serverless instances; fine for local dev, not for production).
import { getSupabaseClient } from "@/lib/supabase/client";
import type { BatchCaseResult } from "@/lib/batch/run-batch";

export type StoredBatchRun = {
  batchRunId: string;
  createdAt: string;
  cases: BatchCaseResult[];
};

let memoryStore: StoredBatchRun | null = null;

export function resetCaseResultsForTests(): void {
  memoryStore = null;
}

export async function saveBatchRun(cases: BatchCaseResult[]): Promise<StoredBatchRun> {
  const run: StoredBatchRun = {
    batchRunId: `run_${Date.now()}`,
    createdAt: new Date().toISOString(),
    cases,
  };

  const client = getSupabaseClient();
  if (client) {
    const { error: delError } = await client.from("case_results").delete().neq("case_id", "__never__");
    if (delError) console.warn("[case-results] warning clearing case_results:", delError.message);

    const rows = cases.map((c) => ({
      case_id: c.caseId,
      batch_run_id: run.batchRunId,
      customer_id: c.customerId,
      record_type: c.recordType,
      root_cause: c.rootCause,
      diagnosis_confidence: c.diagnosisConfidence,
      diagnosis_source: c.diagnosisSource,
      needs_human_review: c.needsHumanReview,
      paused_by_circuit_breaker: c.pausedByCircuitBreaker,
      actions_json: c.actions,
      naive_actions_json: c.naiveActions,
      created_at: run.createdAt,
    }));
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { error } = await client.from("case_results").insert(rows.slice(i, i + chunkSize) as never);
      if (error) console.error("[case-results] FAILED inserting case_results chunk:", error.message);
    }
  }

  memoryStore = run;
  return run;
}

export async function getCaseResult(caseId: string): Promise<BatchCaseResult | null> {
  const run = await loadLatestBatchRun();
  if (!run) return null;
  return run.cases.find((c) => c.caseId === caseId) ?? null;
}

export async function loadLatestBatchRun(): Promise<StoredBatchRun | null> {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client.from("case_results").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("[case-results] FAILED reading case_results:", error.message);
    } else if (data && data.length > 0) {
      const cases: BatchCaseResult[] = data.map((row) => ({
        caseId: row.case_id,
        customerId: row.customer_id,
        recordType: row.record_type,
        rootCause: row.root_cause,
        diagnosisConfidence: row.diagnosis_confidence,
        diagnosisSource: row.diagnosis_source,
        needsHumanReview: row.needs_human_review,
        pausedByCircuitBreaker: row.paused_by_circuit_breaker,
        actions: row.actions_json ?? [],
        naiveActions: row.naive_actions_json ?? [],
      }));
      return { batchRunId: data[0].batch_run_id, createdAt: data[0].created_at, cases };
    }
  }

  return memoryStore;
}
