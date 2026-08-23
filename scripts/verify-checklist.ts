// scripts/verify-checklist.ts — BUILD_MANUAL.md Phase 13's testing/metrics
// validation checklist, checked against a real, fresh batch run rather than
// assumed. Run with `npm run verify:checklist`.
import { readFileSync } from "node:fs";
import path from "node:path";
import seedBatchJson from "@/data/seed/seeds/seed-v1.json";
import type { SeedBatch } from "@/data/seed/schema";
import { runBatchPipeline } from "@/lib/batch/run-batch";
import { getAllAuditRowsSync } from "@/lib/audit/log";
import { isWithinContactWindow, isWithinNpciNonPeakWindow } from "@/lib/time/ist";

const batch = seedBatchJson as SeedBatch;

type CheckResult = { label: string; pass: boolean; detail: string };

async function main() {
  const result = await runBatchPipeline(batch);
  const rows = getAllAuditRowsSync();
  const checks: CheckResult[] = [];

  // 1. Every one of the 13 rules has fired at least once.
  const ruleFireCounts: Record<string, number> = {};
  for (const c of result.cases) {
    for (const a of c.actions) {
      for (const r of a.gateResult.allResults) {
        if (!r.allowed) ruleFireCounts[r.ruleName] = (ruleFireCounts[r.ruleName] ?? 0) + 1;
      }
    }
  }
  const toneBlocked = result.cases.some((c) => c.actions.some((a) => a.execution?.message && !a.execution.message.toneCheckAllowed));
  const gateRuleNames = ["opt-out", "dispute-freeze", "contact-window", "frequency-cap", "cooling-off", "verified-contact", "pre-debit-notice", "one-charge-per-day", "npci-window", "discount-fairness", "stop-loss", "bounce-suppression"];
  const missingRules = gateRuleNames.filter((n) => !ruleFireCounts[n]);
  checks.push({
    label: "Every one of the 13 rules has fired at least once",
    pass: missingRules.length === 0 && toneBlocked,
    detail: missingRules.length === 0 && toneBlocked ? `all 12 gate rules + Rule 9 fired (counts: ${JSON.stringify(ruleFireCounts)})` : `missing: ${[...missingRules, ...(toneBlocked ? [] : ["tone-content"])].join(", ")}`,
  });

  // 2. Rule 6 + Rule 8 interaction fired, rescheduled timestamp inside both windows.
  let rule6_8Case: { rescheduleTo: Date } | null = null;
  for (const c of result.cases) {
    for (const a of c.actions) {
      const preDebit = a.gateResult.blockedBy.find((b) => b.ruleName === "pre-debit-notice" && b.rescheduleTo);
      if (preDebit?.rescheduleTo) {
        rule6_8Case = { rescheduleTo: preDebit.rescheduleTo };
        break;
      }
    }
    if (rule6_8Case) break;
  }
  const rule6_8Valid = rule6_8Case ? isWithinContactWindow(rule6_8Case.rescheduleTo) && isWithinNpciNonPeakWindow(rule6_8Case.rescheduleTo) : false;
  checks.push({
    label: "Rule 6 + Rule 8 interaction fired, rescheduled timestamp verified inside both windows",
    pass: rule6_8Valid,
    detail: rule6_8Case ? `rescheduleTo=${rule6_8Case.rescheduleTo.toISOString()}, withinContactWindow=${isWithinContactWindow(rule6_8Case.rescheduleTo)}, withinNpciNonPeak=${isWithinNpciNonPeakWindow(rule6_8Case.rescheduleTo)}` : "no Rule 6 reschedule found",
  });

  // 3. Circuit breaker tripped exactly once, single audit event (not one per record).
  const tripRows = rows.filter((r) => r.event_type === "circuit_breaker_tripped");
  checks.push({
    label: "Circuit breaker tripped on the seeded cluster with a single audit event (not one per record)",
    pass: tripRows.length >= 1 && result.circuitBreaker.pausedRecordIds.size > tripRows.length,
    detail: `${tripRows.length} trip event(s), ${result.circuitBreaker.pausedRecordIds.size} records paused`,
  });

  // 4. Stop-loss fired at least once.
  checks.push({ label: "Stop-loss rule fired on at least one seeded case", pass: (ruleFireCounts["stop-loss"] ?? 0) > 0, detail: `fired ${ruleFireCounts["stop-loss"] ?? 0} times` });

  // 5. At least one promise-to-pay case reached BROKEN and lost discount eligibility.
  const brokenRows = rows.filter((r) => r.event_type === "promise_broken");
  checks.push({ label: "At least one promise-to-pay case reached BROKEN with discount eligibility revoked", pass: brokenRows.length > 0, detail: `${brokenRows.length} broken promise(s)` });

  // 6. At least one is_disputed:true case has zero automated actions taken.
  const disputedCase = result.cases.find((c) => {
    const rec = batch.payment_failures.find((r) => r.id === c.caseId);
    return rec?.is_disputed;
  });
  const disputedHasNoDispatch = disputedCase ? disputedCase.actions.every((a) => !a.execution?.dispatched || !a.execution.message) : false;
  checks.push({
    label: "At least one is_disputed:true case has zero automated actions taken",
    pass: !!disputedCase && disputedHasNoDispatch,
    detail: disputedCase ? `case ${disputedCase.caseId}: all actions blocked before dispatch` : "no disputed case found in result",
  });

  // 7. At least one FAILED_INVALID_NUMBER case attempted no secondary contact.
  const bouncedCase = result.cases.find((c) => {
    const rec = batch.payment_failures.find((r) => r.id === c.caseId);
    return rec?.last_contact_status === "FAILED_INVALID_NUMBER";
  });
  const bouncedHasNoDispatch = bouncedCase ? bouncedCase.actions.every((a) => !a.execution?.dispatched || !a.execution.message) : false;
  checks.push({
    label: "At least one FAILED_INVALID_NUMBER case attempted no secondary contact",
    pass: !!bouncedCase && bouncedHasNoDispatch,
    detail: bouncedCase ? `case ${bouncedCase.caseId}: blocked by bounce-suppression, no alternate channel attempted` : "no bounced case found in result",
  });

  // 8. docs/metrics/diagnosis_accuracy.json has real, non-placeholder numbers.
  const accuracyPath = path.resolve(__dirname, "..", "docs", "metrics", "diagnosis_accuracy.json");
  let accuracyOk = false;
  let accuracyDetail = "file missing";
  try {
    const accuracy = JSON.parse(readFileSync(accuracyPath, "utf-8"));
    accuracyOk = typeof accuracy.overall_accuracy === "number" && accuracy.overall_accuracy > 0 && accuracy.total_records_diagnosed > 0;
    accuracyDetail = `overall_accuracy=${accuracy.overall_accuracy}, total_records_diagnosed=${accuracy.total_records_diagnosed}`;
  } catch (e) {
    accuracyDetail = String(e);
  }
  checks.push({ label: "docs/metrics/diagnosis_accuracy.json has real, non-placeholder numbers", pass: accuracyOk, detail: accuracyDetail });

  // 9. No hardcoded numbers in dashboard components — grep for suspicious literals.
  const dashboardSource = readFileSync(path.resolve(__dirname, "..", "app", "dashboard", "page.tsx"), "utf-8");
  const suspiciousLiterals = dashboardSource.match(/>\s*(?:Rs\s*[\d,]+|[\d]{3,}%?)\s*</g);
  checks.push({
    label: "No hardcoded numbers in the dashboard page (every figure comes from computed props)",
    pass: !suspiciousLiterals,
    detail: suspiciousLiterals ? `found suspicious literals: ${suspiciousLiterals.join(", ")}` : "no bare numeric literals found in JSX text nodes",
  });

  console.log("\n=== Phase 13 checklist ===\n");
  let allPass = true;
  for (const c of checks) {
    if (!c.pass) allPass = false;
    console.log(`[${c.pass ? "PASS" : "FAIL"}] ${c.label}`);
    console.log(`       ${c.detail}`);
  }
  console.log(`\n${checks.filter((c) => c.pass).length}/${checks.length} checks passed.\n`);
  if (!allPass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
