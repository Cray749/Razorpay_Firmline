// lib/rules/08-npci-window.ts — NPCI UPI rules: AutoPay debit retries may
// only run in specific non-peak windows.
import { isWithinNpciNonPeakWindow, formatIST } from "@/lib/time/ist";
import { fromZonedTime } from "date-fns-tz";
import { IST_TIME_ZONE } from "@/lib/time/ist";
import { MANDATE_RETRY_ACTION_TYPES } from "@/lib/actions/types";
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const checkNpciWindow: ComplianceRule = (action): RuleResult => {
  if (!MANDATE_RETRY_ACTION_TYPES.includes(action.actionType)) {
    return { allowed: true, reason: "Not an AutoPay retry action — NPCI non-peak window does not apply." };
  }
  if (isWithinNpciNonPeakWindow(action.proposedAt)) {
    return { allowed: true, reason: "Proposed retry time falls inside an NPCI non-peak window." };
  }
  return {
    allowed: false,
    reason: `Proposed retry time (${formatIST(action.proposedAt)}) falls inside an NPCI peak window — AutoPay retries are only permitted before 10:00, 13:00-17:00, or after 21:30 IST.`,
  };
};

const ist = (naiveIso: string) => fromZonedTime(naiveIso, IST_TIME_ZONE);

export const testCases: RuleTestCase[] = [
  {
    name: "13:00 IST retry is within a non-peak band, allowed",
    action: makeTestAction({ actionType: "SCHEDULE_COMPLIANT_RETRY", proposedAt: ist("2026-08-12T13:00:00") }),
    context: makeTestContext(),
    expectAllowed: true,
  },
  {
    name: "11:00 IST retry is inside a peak window, blocked",
    action: makeTestAction({ actionType: "SCHEDULE_COMPLIANT_RETRY", proposedAt: ist("2026-08-12T11:00:00") }),
    context: makeTestContext(),
    expectAllowed: false,
    expectReasonContains: "NPCI peak window",
  },
  {
    name: "boundary: exactly 10:00:00 IST is peak (band closed), blocked",
    action: makeTestAction({ actionType: "SCHEDULE_COMPLIANT_RETRY", proposedAt: ist("2026-08-12T10:00:00") }),
    context: makeTestContext(),
    expectAllowed: false,
  },
  {
    name: "non-retry action is allowed regardless of NPCI window",
    action: makeTestAction({ actionType: "SEND_SOFT_REMINDER", proposedAt: ist("2026-08-12T11:00:00") }),
    context: makeTestContext(),
    expectAllowed: true,
  },
];
