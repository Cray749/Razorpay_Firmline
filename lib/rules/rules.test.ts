// lib/rules/rules.test.ts — the shared test harness every rule's test cases
// run through (BUILD_MANUAL.md Phase 8.1), plus the actual test run that
// imports every one of the 13 rules' exported testCases arrays.
import type { ComplianceRule, RuleTestCase } from "./types";

export function runRuleTestCases(rule: ComplianceRule, cases: RuleTestCase[]): void {
  for (const c of cases) {
    const result = rule(c.action, c.context);
    if (result.allowed !== c.expectAllowed) {
      throw new Error(`FAILED: ${c.name} — expected allowed=${c.expectAllowed}, got ${result.allowed} (reason: ${result.reason})`);
    }
    if (c.expectReasonContains && !result.reason.includes(c.expectReasonContains)) {
      throw new Error(`FAILED: ${c.name} — reason did not mention "${c.expectReasonContains}" (got: "${result.reason}")`);
    }
  }
}

import { checkContactWindow } from "./01-contact-window";
import { checkFrequencyCap } from "./02-frequency-cap";
import { checkCoolingOff } from "./03-cooling-off";
import { checkOptOut } from "./04-opt-out";
import { checkVerifiedContact } from "./05-verified-contact";
import { checkPreDebitNotice, verifyRescheduleSatisfiesBothWindows } from "./06-pre-debit-notice";
import { checkOneChargePerDay } from "./07-one-charge-per-day";
import { checkNpciWindow } from "./08-npci-window";
import { checkToneContent, messageTestCases } from "./09-tone-content";
import { checkDiscountFairness } from "./10-discount-fairness";
import { checkStopLoss } from "./11-stop-loss";
import { checkBounceSuppression } from "./12-bounce-suppression";
import { checkDisputeFreeze } from "./13-dispute-freeze";

import { testCases as tc01 } from "./01-contact-window";
import { testCases as tc02 } from "./02-frequency-cap";
import { testCases as tc03 } from "./03-cooling-off";
import { testCases as tc04 } from "./04-opt-out";
import { testCases as tc05 } from "./05-verified-contact";
import { testCases as tc06 } from "./06-pre-debit-notice";
import { testCases as tc07 } from "./07-one-charge-per-day";
import { testCases as tc08 } from "./08-npci-window";
import { testCases as tc10 } from "./10-discount-fairness";
import { testCases as tc11 } from "./11-stop-loss";
import { testCases as tc12 } from "./12-bounce-suppression";
import { testCases as tc13 } from "./13-dispute-freeze";

export default function run(): void {
  runRuleTestCases(checkContactWindow, tc01);
  console.log(`  PASS  Rule 1 (contact-window): ${tc01.length} cases`);
  runRuleTestCases(checkFrequencyCap, tc02);
  console.log(`  PASS  Rule 2 (frequency-cap): ${tc02.length} cases`);
  runRuleTestCases(checkCoolingOff, tc03);
  console.log(`  PASS  Rule 3 (cooling-off): ${tc03.length} cases`);
  runRuleTestCases(checkOptOut, tc04);
  console.log(`  PASS  Rule 4 (opt-out): ${tc04.length} cases`);
  runRuleTestCases(checkVerifiedContact, tc05);
  console.log(`  PASS  Rule 5 (verified-contact): ${tc05.length} cases`);
  runRuleTestCases(checkPreDebitNotice, tc06);
  verifyRescheduleSatisfiesBothWindows();
  console.log(`  PASS  Rule 6 (pre-debit-notice): ${tc06.length} cases + reschedule window check`);
  runRuleTestCases(checkOneChargePerDay, tc07);
  console.log(`  PASS  Rule 7 (one-charge-per-day): ${tc07.length} cases`);
  runRuleTestCases(checkNpciWindow, tc08);
  console.log(`  PASS  Rule 8 (npci-window): ${tc08.length} cases`);

  for (const c of messageTestCases) {
    const result = checkToneContent(c.messageText);
    if (result.allowed !== c.expectAllowed) {
      throw new Error(`FAILED: ${c.name} — expected allowed=${c.expectAllowed}, got ${result.allowed} (reason: ${result.reason})`);
    }
    if (c.expectReasonContains && !result.reason.includes(c.expectReasonContains)) {
      throw new Error(`FAILED: ${c.name} — reason did not mention "${c.expectReasonContains}" (got: "${result.reason}")`);
    }
  }
  console.log(`  PASS  Rule 9 (tone-content): ${messageTestCases.length} cases`);

  runRuleTestCases(checkDiscountFairness, tc10);
  console.log(`  PASS  Rule 10 (discount-fairness): ${tc10.length} cases`);
  runRuleTestCases(checkStopLoss, tc11);
  console.log(`  PASS  Rule 11 (stop-loss): ${tc11.length} cases`);
  runRuleTestCases(checkBounceSuppression, tc12);
  console.log(`  PASS  Rule 12 (bounce-suppression): ${tc12.length} cases`);
  runRuleTestCases(checkDisputeFreeze, tc13);
  console.log(`  PASS  Rule 13 (dispute-freeze): ${tc13.length} cases`);

  console.log("rules.test.ts: all 13 rules' test cases passed");
}
