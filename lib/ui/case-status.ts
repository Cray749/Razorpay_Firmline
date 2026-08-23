// lib/ui/case-status.ts — derives a simple, display-friendly status from a
// BatchCaseResult's action outcomes. Shared by the batch view, dashboard, and
// case detail page so "cleared vs blocked" always means the same thing.
import type { BatchCaseResult } from "@/lib/batch/run-batch";

export type CaseStatus = "PAUSED" | "CLEARED" | "BLOCKED" | "PARTIAL" | "NO_ACTION";

/** An action counts as "blocked" for display purposes if either the 12-rule
 * gate rejected it, OR it passed the gate but Rule 9's second-stage tone
 * check on the generated message failed (BUILD_MANUAL.md 13.2: Rule 9 runs
 * separately, after message generation, not inside the main gate) — from a
 * "did Firmline actually let this happen" standpoint, both are the same
 * outcome: nothing was sent. */
function wasEffectivelyBlocked(a: BatchCaseResult["actions"][number]): boolean {
  if (!a.gateResult.allowed) return true;
  if (a.execution?.message && !a.execution.message.toneCheckAllowed) return true;
  return false;
}

export function deriveCaseStatus(c: BatchCaseResult): CaseStatus {
  if (c.pausedByCircuitBreaker) return "PAUSED";
  const primary = c.actions.filter((a) => !a.isAutoInsertedNotice);
  if (primary.length === 0) return "NO_ACTION";
  const blocked = primary.filter(wasEffectivelyBlocked).length;
  const cleared = primary.length - blocked;
  if (blocked > 0 && cleared === 0) return "BLOCKED";
  if (blocked > 0 && cleared > 0) return "PARTIAL";
  return "CLEARED";
}

export function isStampCleared(status: CaseStatus): boolean {
  return status === "CLEARED" || status === "NO_ACTION";
}
