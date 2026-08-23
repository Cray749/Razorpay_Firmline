// lib/rules/06-pre-debit-notice.ts — UPI AutoPay mandate rules: a recurring
// charge retry needs 24 hours' notice first. This rule doesn't just reject —
// it computes rescheduleTo via nextValidComplianceSlot(proposedAt + 24h, isAutoPayRetry:true),
// NOT a raw proposedAt + 24h. A raw +24h reschedule preserves time-of-day, so
// a failure at 11 PM would naively reschedule to 11 PM the next day — still
// outside the contact window. Routing through nextValidComplianceSlot
// guarantees the result satisfies both Rule 1 (contact window) and Rule 8
// (NPCI non-peak window) simultaneously. The gate/orchestrator is responsible
// for actually inserting a SEND_PRE_DEBIT_NOTICE action when this fires —
// this rule only computes whether notice is missing and where to reschedule to.
import { nextValidComplianceSlot, formatIST, isWithinContactWindow, isWithinNpciNonPeakWindow } from "@/lib/time/ist";
import { MANDATE_RETRY_ACTION_TYPES } from "@/lib/actions/types";
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext, BASE_TIME } from "./test-fixtures";

export const PRE_DEBIT_NOTICE_LEAD_HOURS = 24;

export const checkPreDebitNotice: ComplianceRule = (action, context): RuleResult => {
  if (!MANDATE_RETRY_ACTION_TYPES.includes(action.actionType)) {
    return { allowed: true, reason: "Not a mandate retry action — pre-debit notice does not apply." };
  }

  const leadMs = PRE_DEBIT_NOTICE_LEAD_HOURS * 60 * 60 * 1000;
  const noticeIsSufficient =
    context.preDebitNoticeSentAt !== null && action.proposedAt.getTime() - context.preDebitNoticeSentAt.getTime() >= leadMs;

  if (noticeIsSufficient) {
    return { allowed: true, reason: `Pre-debit notice was sent at ${formatIST(context.preDebitNoticeSentAt!)}, at least ${PRE_DEBIT_NOTICE_LEAD_HOURS}h before the proposed retry.` };
  }

  const rescheduleTo = nextValidComplianceSlot(new Date(action.proposedAt.getTime() + leadMs), true);
  return {
    allowed: false,
    reason: `No pre-debit notice on file at least ${PRE_DEBIT_NOTICE_LEAD_HOURS}h before this retry — inserting a SEND_PRE_DEBIT_NOTICE action and rescheduling the retry to ${formatIST(rescheduleTo)}, the next slot that satisfies both the contact window and the NPCI non-peak window.`,
    rescheduleTo,
  };
};

export const testCases: RuleTestCase[] = [
  {
    name: "non-mandate-retry action is allowed regardless of notice",
    action: makeTestAction({ actionType: "SEND_SOFT_REMINDER" }),
    context: makeTestContext({ preDebitNoticeSentAt: null }),
    expectAllowed: true,
  },
  {
    name: "notice sent 25h before is allowed",
    action: makeTestAction({ actionType: "SCHEDULE_COMPLIANT_RETRY", proposedAt: BASE_TIME }),
    context: makeTestContext({ preDebitNoticeSentAt: new Date(BASE_TIME.getTime() - 25 * 60 * 60 * 1000) }),
    expectAllowed: true,
  },
  {
    name: "boundary: notice sent exactly 24h before is allowed",
    action: makeTestAction({ actionType: "SCHEDULE_COMPLIANT_RETRY", proposedAt: BASE_TIME }),
    context: makeTestContext({ preDebitNoticeSentAt: new Date(BASE_TIME.getTime() - 24 * 60 * 60 * 1000) }),
    expectAllowed: true,
  },
  {
    name: "missing notice is blocked and rescheduled to a slot satisfying both windows",
    action: makeTestAction({ actionType: "SCHEDULE_COMPLIANT_RETRY", proposedAt: BASE_TIME }),
    context: makeTestContext({ preDebitNoticeSentAt: null }),
    expectAllowed: false,
    expectReasonContains: "No pre-debit notice",
  },
];

// Extra assertion beyond the shared harness: the computed rescheduleTo must
// actually satisfy both the contact window AND the NPCI non-peak window —
// this is the specific Rule 6 + 8 interaction the manual calls out.
export function verifyRescheduleSatisfiesBothWindows(): void {
  const action = makeTestAction({ actionType: "SCHEDULE_COMPLIANT_RETRY", proposedAt: BASE_TIME });
  const context = makeTestContext({ preDebitNoticeSentAt: null });
  const result = checkPreDebitNotice(action, context);
  if (result.allowed || !result.rescheduleTo) {
    throw new Error("expected a blocked result with a rescheduleTo");
  }
  if (!isWithinContactWindow(result.rescheduleTo)) {
    throw new Error(`rescheduleTo ${result.rescheduleTo.toISOString()} is not within the contact window`);
  }
  if (!isWithinNpciNonPeakWindow(result.rescheduleTo)) {
    throw new Error(`rescheduleTo ${result.rescheduleTo.toISOString()} is not within the NPCI non-peak window`);
  }
}
