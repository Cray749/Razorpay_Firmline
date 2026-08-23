// lib/ui/case-status.ts — derives a simple, display-friendly status from a
// BatchCaseResult's action outcomes. Shared by the batch view, dashboard, and
// case detail page so "cleared vs blocked" always means the same thing.
import type { BatchCaseResult } from "@/lib/batch/run-batch";

export type CaseStatus = "PAUSED" | "CLEARED" | "BLOCKED" | "PARTIAL" | "NO_ACTION";

export function deriveCaseStatus(c: BatchCaseResult): CaseStatus {
  if (c.pausedByCircuitBreaker) return "PAUSED";
  const primary = c.actions.filter((a) => !a.isAutoInsertedNotice);
  if (primary.length === 0) return "NO_ACTION";
  const blocked = primary.filter((a) => !a.gateResult.allowed).length;
  const cleared = primary.filter((a) => a.gateResult.allowed).length;
  if (blocked > 0 && cleared === 0) return "BLOCKED";
  if (blocked > 0 && cleared > 0) return "PARTIAL";
  return "CLEARED";
}

export function isStampCleared(status: CaseStatus): boolean {
  return status === "CLEARED" || status === "NO_ACTION";
}
