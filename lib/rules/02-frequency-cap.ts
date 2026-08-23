// lib/rules/02-frequency-cap.ts — RBI Fair Practices Code: no more than
// 2 total contacts per customer per day, or 5 per week, across every channel
// combined. context.contactsTrailing24h/7d are pre-computed from the real
// audit log (see lib/rules/context.ts) — this rule just compares against them.
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const DAILY_CONTACT_CAP = 2;
export const WEEKLY_CONTACT_CAP = 5;

export const checkFrequencyCap: ComplianceRule = (_action, context): RuleResult => {
  if (context.contactsTrailing24h >= DAILY_CONTACT_CAP) {
    return {
      allowed: false,
      reason: `Another contact would exceed the daily cap of ${DAILY_CONTACT_CAP} (already ${context.contactsTrailing24h} in the trailing 24h, across all channels).`,
    };
  }
  if (context.contactsTrailing7d >= WEEKLY_CONTACT_CAP) {
    return {
      allowed: false,
      reason: `Another contact would exceed the weekly cap of ${WEEKLY_CONTACT_CAP} (already ${context.contactsTrailing7d} in the trailing 7 days, across all channels).`,
    };
  }
  return { allowed: true, reason: `Within frequency caps (${context.contactsTrailing24h}/${DAILY_CONTACT_CAP} today, ${context.contactsTrailing7d}/${WEEKLY_CONTACT_CAP} this week).` };
};

export const testCases: RuleTestCase[] = [
  {
    name: "no prior contacts is allowed",
    action: makeTestAction(),
    context: makeTestContext({ contactsTrailing24h: 0, contactsTrailing7d: 0 }),
    expectAllowed: true,
  },
  {
    name: "boundary: 1 contact today is still allowed (cap is 2)",
    action: makeTestAction(),
    context: makeTestContext({ contactsTrailing24h: 1, contactsTrailing7d: 1 }),
    expectAllowed: true,
  },
  {
    name: "boundary: 2 contacts today hits the daily cap and is blocked",
    action: makeTestAction(),
    context: makeTestContext({ contactsTrailing24h: 2, contactsTrailing7d: 2 }),
    expectAllowed: false,
    expectReasonContains: "daily cap",
  },
  {
    name: "5 contacts this week hits the weekly cap even if today is clear",
    action: makeTestAction(),
    context: makeTestContext({ contactsTrailing24h: 0, contactsTrailing7d: 5 }),
    expectAllowed: false,
    expectReasonContains: "weekly cap",
  },
];
