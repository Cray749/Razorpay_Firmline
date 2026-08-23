// lib/rules/11-stop-loss.ts — our own design choice: stop contacting a
// customer past a fixed attempt limit with no resolution. Reads
// previousAttemptsTotal21d directly (a baseline record field, not something
// that needs audit-log derivation) — see also the Decision layer's proactive
// check in lib/actions/decision-table.ts, which tries to avoid ever proposing
// a retry the gate would reject here anyway.
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const STOP_LOSS_ATTEMPT_THRESHOLD = 5; // must match lib/actions/decision-table.ts's STOP_LOSS_THRESHOLD

export const checkStopLoss: ComplianceRule = (_action, context): RuleResult => {
  if (context.previousAttemptsTotal21d >= STOP_LOSS_ATTEMPT_THRESHOLD) {
    return {
      allowed: false,
      reason: `${context.previousAttemptsTotal21d} attempts in the trailing 21 days with no resolution meets the stop-loss threshold (${STOP_LOSS_ATTEMPT_THRESHOLD}) — further automated contact is blocked; substitute STOP_AND_WRITE_OFF or ESCALATE_TO_HUMAN.`,
    };
  }
  return { allowed: true, reason: `${context.previousAttemptsTotal21d} attempts in the trailing 21 days, under the stop-loss threshold (${STOP_LOSS_ATTEMPT_THRESHOLD}).` };
};

export const testCases: RuleTestCase[] = [
  {
    name: "well under the threshold is allowed",
    action: makeTestAction(),
    context: makeTestContext({ previousAttemptsTotal21d: 2 }),
    expectAllowed: true,
  },
  {
    name: "boundary: exactly at the threshold (5) is blocked",
    action: makeTestAction(),
    context: makeTestContext({ previousAttemptsTotal21d: 5 }),
    expectAllowed: false,
    expectReasonContains: "stop-loss threshold",
  },
  {
    name: "boundary: one under the threshold (4) is allowed",
    action: makeTestAction(),
    context: makeTestContext({ previousAttemptsTotal21d: 4 }),
    expectAllowed: true,
  },
];
