// lib/rules/01-contact-window.ts — RBI 2026 recovery directions: no outbound
// contact outside 08:00-19:00 IST. No parameter on this function accepts an
// override — the only way to change the boundary is editing this file
// directly, never at runtime.
import { isWithinContactWindow, formatIST } from "@/lib/time/ist";
import { fromZonedTime } from "date-fns-tz";
import { IST_TIME_ZONE } from "@/lib/time/ist";
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const checkContactWindow: ComplianceRule = (action): RuleResult => {
  if (isWithinContactWindow(action.proposedAt)) {
    return { allowed: true, reason: "Proposed contact time is within the 08:00-19:00 IST contact window." };
  }
  return {
    allowed: false,
    reason: `Proposed contact time (${formatIST(action.proposedAt)}) falls outside the 08:00-19:00 IST contact window mandated by RBI's 2026 recovery directions.`,
  };
};

const ist = (naiveIso: string) => fromZonedTime(naiveIso, IST_TIME_ZONE);

export const testCases: RuleTestCase[] = [
  {
    name: "13:00 IST is within the window",
    action: makeTestAction({ proposedAt: ist("2026-08-12T13:00:00") }),
    context: makeTestContext(),
    expectAllowed: true,
  },
  {
    name: "23:45 IST is blocked",
    action: makeTestAction({ proposedAt: ist("2026-08-12T23:45:00") }),
    context: makeTestContext(),
    expectAllowed: false,
    expectReasonContains: "outside the 08:00-19:00 IST contact window",
  },
  {
    name: "boundary: exactly 08:00:00 is allowed (inclusive open)",
    action: makeTestAction({ proposedAt: ist("2026-08-12T08:00:00") }),
    context: makeTestContext(),
    expectAllowed: true,
  },
  {
    name: "boundary: exactly 19:00:00 is blocked (exclusive close)",
    action: makeTestAction({ proposedAt: ist("2026-08-12T19:00:00") }),
    context: makeTestContext(),
    expectAllowed: false,
  },
];
