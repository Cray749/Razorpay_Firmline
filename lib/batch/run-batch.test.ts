import { check } from "@/lib/test-utils/harness";
import { runBatchPipeline } from "./run-batch";
import { resetAuditLogForTests, getAllAuditRowsSync } from "@/lib/audit/log";
import { resetContextBackfillForTests } from "@/lib/rules/context";
import { resetPromiseTrackerForTests } from "@/lib/promise-tracker/state-machine";
import seedBatchJson from "@/data/seed/seeds/seed-v1.json";
import type { SeedBatch } from "@/data/seed/schema";

const batch = seedBatchJson as SeedBatch;

// Fixed "now" for B2B actions (which have no per-record timestamp field) so
// this test is deterministic regardless of when it's actually run.
const FIXED_NOW = new Date("2026-08-12T13:00:00.000Z");

export default async function run(): Promise<void> {
  resetAuditLogForTests();
  resetContextBackfillForTests();
  resetPromiseTrackerForTests();

  const result = await runBatchPipeline(batch, FIXED_NOW);

  // Count how many times each of the 13 rules actually BLOCKED an action,
  // across the whole batch, straight from the gate's own results.
  const blockCounts: Record<string, number> = {};
  let rescheduleCount = 0;
  for (const c of result.cases) {
    for (const { gateResult } of c.actions) {
      for (const blocked of gateResult.blockedBy) {
        blockCounts[blocked.ruleName] = (blockCounts[blocked.ruleName] ?? 0) + 1;
        if (blocked.rescheduleTo) rescheduleCount++;
      }
    }
  }

  console.log("  Rule fire counts across the real batch run:");
  for (const [rule, count] of Object.entries(blockCounts).sort()) {
    console.log(`    ${rule}: ${count}`);
  }

  const ruleNames = ["opt-out", "dispute-freeze", "contact-window", "frequency-cap", "cooling-off", "verified-contact", "pre-debit-notice", "one-charge-per-day", "npci-window", "discount-fairness", "stop-loss", "bounce-suppression"];
  for (const name of ruleNames) {
    check((blockCounts[name] ?? 0) > 0, `Rule "${name}" must fire (block at least one action) in the real batch run — zero fires means the seed data or the rule has a bug`);
  }

  check(rescheduleCount > 0, "Rule 6 (pre-debit-notice) must produce at least one reschedule in the real batch run");

  // Manual trace: find one Rule 6 + 8 interaction case and confirm the
  // rescheduled timestamp is provably inside both valid windows.
  const { isWithinContactWindow, isWithinNpciNonPeakWindow } = await import("@/lib/time/ist");
  let tracedOne = false;
  for (const c of result.cases) {
    for (const { gateResult } of c.actions) {
      const preDebit = gateResult.blockedBy.find((b) => b.ruleName === "pre-debit-notice" && b.rescheduleTo);
      if (preDebit?.rescheduleTo) {
        check(isWithinContactWindow(preDebit.rescheduleTo), `traced rescheduleTo (${preDebit.rescheduleTo.toISOString()}) must be within the contact window`);
        check(isWithinNpciNonPeakWindow(preDebit.rescheduleTo), `traced rescheduleTo (${preDebit.rescheduleTo.toISOString()}) must be within the NPCI non-peak window`);
        tracedOne = true;
        break;
      }
    }
    if (tracedOne) break;
  }
  check(tracedOne, "must have traced at least one real Rule 6+8 interaction case from the batch run");

  const totalRows = getAllAuditRowsSync().length;
  check(totalRows > 0, "the batch run must produce audit log rows");

  console.log(`  PASS  gate ran against ${result.cases.length} real cases, all 12 non-tone rules fired at least once, Rule 6+8 interaction traced and verified`);
  console.log("run-batch.test.ts: all assertions passed");
}
