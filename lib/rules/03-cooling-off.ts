// lib/rules/03-cooling-off.ts — RBI Fair Practices Code: two contacts too
// close together are blocked even if the daily cap hasn't been hit yet.
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext, BASE_TIME } from "./test-fixtures";

export const COOLING_OFF_HOURS = 4;

export const checkCoolingOff: ComplianceRule = (action, context): RuleResult => {
  if (!context.lastContactAt) {
    return { allowed: true, reason: "No prior contact on record — cooling-off period does not apply." };
  }
  const hoursSinceLastContact = (action.proposedAt.getTime() - context.lastContactAt.getTime()) / (60 * 60 * 1000);
  if (hoursSinceLastContact < COOLING_OFF_HOURS) {
    return {
      allowed: false,
      reason: `Last contact was ${hoursSinceLastContact.toFixed(1)}h ago, under the ${COOLING_OFF_HOURS}h cooling-off period, regardless of the daily cap.`,
    };
  }
  return { allowed: true, reason: `Last contact was ${hoursSinceLastContact.toFixed(1)}h ago, clear of the ${COOLING_OFF_HOURS}h cooling-off period.` };
};

export const testCases: RuleTestCase[] = [
  {
    name: "no prior contact is allowed",
    action: makeTestAction(),
    context: makeTestContext({ lastContactAt: null }),
    expectAllowed: true,
  },
  {
    name: "last contact 1 hour ago is blocked",
    action: makeTestAction({ proposedAt: BASE_TIME }),
    context: makeTestContext({ lastContactAt: new Date(BASE_TIME.getTime() - 1 * 60 * 60 * 1000) }),
    expectAllowed: false,
    expectReasonContains: "cooling-off",
  },
  {
    name: "boundary: exactly 4 hours ago is allowed (inclusive)",
    action: makeTestAction({ proposedAt: BASE_TIME }),
    context: makeTestContext({ lastContactAt: new Date(BASE_TIME.getTime() - 4 * 60 * 60 * 1000) }),
    expectAllowed: true,
  },
  {
    name: "last contact 5 hours ago is allowed",
    action: makeTestAction({ proposedAt: BASE_TIME }),
    context: makeTestContext({ lastContactAt: new Date(BASE_TIME.getTime() - 5 * 60 * 60 * 1000) }),
    expectAllowed: true,
  },
];
