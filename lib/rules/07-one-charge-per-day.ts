// lib/rules/07-one-charge-per-day.ts — NPCI UPI rules: only one charge
// attempt per mandate per day (IST calendar day).
import { MANDATE_RETRY_ACTION_TYPES } from "@/lib/actions/types";
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const checkOneChargePerDay: ComplianceRule = (action, context): RuleResult => {
  if (!MANDATE_RETRY_ACTION_TYPES.includes(action.actionType) || !action.mandateId) {
    return { allowed: true, reason: "Not a mandate charge action — one-charge-per-day does not apply." };
  }
  if (context.mandateChargeAttemptedTodayOnMandate) {
    return {
      allowed: false,
      reason: `Mandate ${action.mandateId} already had a charge attempt today (IST calendar day) — NPCI allows only one attempt per mandate per day.`,
    };
  }
  return { allowed: true, reason: `Mandate ${action.mandateId} has not been charged yet today.` };
};

export const testCases: RuleTestCase[] = [
  {
    name: "no charge today is allowed",
    action: makeTestAction({ actionType: "SCHEDULE_COMPLIANT_RETRY", mandateId: "mandate_1" }),
    context: makeTestContext({ mandateChargeAttemptedTodayOnMandate: false }),
    expectAllowed: true,
  },
  {
    name: "already charged today is blocked",
    action: makeTestAction({ actionType: "SCHEDULE_COMPLIANT_RETRY", mandateId: "mandate_1" }),
    context: makeTestContext({ mandateChargeAttemptedTodayOnMandate: true }),
    expectAllowed: false,
    expectReasonContains: "already had a charge attempt today",
  },
  {
    name: "non-mandate action is allowed regardless",
    action: makeTestAction({ actionType: "SEND_SOFT_REMINDER" }),
    context: makeTestContext({ mandateChargeAttemptedTodayOnMandate: true }),
    expectAllowed: true,
  },
];
