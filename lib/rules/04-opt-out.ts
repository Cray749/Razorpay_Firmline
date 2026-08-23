// lib/rules/04-opt-out.ts — RBI Fair Practices Code / DPDP Act: never contact
// someone who's asked to stop. Checked first, before any other rule, by the
// gate aggregator (lib/rules/gate.ts) — no reason to evaluate anything else
// once this fires.
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const checkOptOut: ComplianceRule = (_action, context): RuleResult => {
  if (context.isOptedOut) {
    return { allowed: false, reason: "Customer has opted out / is on the DND list — no automated contact is permitted." };
  }
  return { allowed: true, reason: "Customer has not opted out." };
};

export const testCases: RuleTestCase[] = [
  {
    name: "not opted out is allowed",
    action: makeTestAction(),
    context: makeTestContext({ isOptedOut: false }),
    expectAllowed: true,
  },
  {
    name: "opted out is blocked",
    action: makeTestAction(),
    context: makeTestContext({ isOptedOut: true }),
    expectAllowed: false,
    expectReasonContains: "opted out",
  },
];
