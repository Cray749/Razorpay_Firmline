// lib/rules/13-dispute-freeze.ts — basic fairness: an agent must stop the
// moment a human says stop. Checked early by the gate aggregator, alongside
// Rule 4 — there's no scenario where a disputed record should be contacted
// automatically regardless of what any other rule says.
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const checkDisputeFreeze: ComplianceRule = (_action, context): RuleResult => {
  if (context.isDisputed) {
    return { allowed: false, reason: "Customer has an open dispute or claims the charge is already paid — all automation on this record is frozen pending human review." };
  }
  return { allowed: true, reason: "No open dispute on record." };
};

export const testCases: RuleTestCase[] = [
  {
    name: "no dispute is allowed",
    action: makeTestAction(),
    context: makeTestContext({ isDisputed: false }),
    expectAllowed: true,
  },
  {
    name: "disputed is blocked",
    action: makeTestAction(),
    context: makeTestContext({ isDisputed: true }),
    expectAllowed: false,
    expectReasonContains: "dispute",
  },
];
