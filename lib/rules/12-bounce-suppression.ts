// lib/rules/12-bounce-suppression.ts — prevents blind retries to a channel
// that just failed to deliver. Per the README, the system does NOT attempt a
// secondary contact method when the verified channel bounced — it marks the
// record for human review instead. This is what keeps the system from
// "getting creative" about finding an alternate way to reach someone, which
// would risk violating the RBI ban on reaching third parties.
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const checkBounceSuppression: ComplianceRule = (_action, context): RuleResult => {
  if (context.lastContactStatus === "FAILED_INVALID_NUMBER") {
    return {
      allowed: false,
      reason: "The verified contact channel bounced (FAILED_INVALID_NUMBER) — no automated retry or alternate-channel attempt; this record is marked for human review instead.",
    };
  }
  return { allowed: true, reason: "No delivery bounce on record for the verified contact channel." };
};

export const testCases: RuleTestCase[] = [
  {
    name: "no prior contact is allowed",
    action: makeTestAction(),
    context: makeTestContext({ lastContactStatus: "NO_PRIOR_CONTACT" }),
    expectAllowed: true,
  },
  {
    name: "delivered status is allowed",
    action: makeTestAction(),
    context: makeTestContext({ lastContactStatus: "DELIVERED" }),
    expectAllowed: true,
  },
  {
    name: "bounced (FAILED_INVALID_NUMBER) is blocked",
    action: makeTestAction(),
    context: makeTestContext({ lastContactStatus: "FAILED_INVALID_NUMBER" }),
    expectAllowed: false,
    expectReasonContains: "bounced",
  },
];
