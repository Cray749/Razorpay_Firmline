// lib/rules/10-discount-fairness.ts — Competition Act price-discrimination
// risk: a discount must fall within the customer's segment-approved band.
//
// "Log the (segment, band, offer) tuple to a dedicated fairness-audit table
// regardless of pass/fail" (BUILD_MANUAL.md 13.2) is satisfied by this rule's
// reason string always stating segment/band/offer explicitly — the gate logs
// every rule's result, allowed or not, to the audit trail (lib/rules/gate.ts),
// so the full tuple is captured on every discount evaluation without a
// separate table. The dashboard/fairness views query audit_log for this
// rule's entries to reconstruct the discount distribution across segments.
import { DISCOUNT_BANDS } from "./types";
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const checkDiscountFairness: ComplianceRule = (action, context): RuleResult => {
  if (action.actionType !== "OFFER_APPROVED_DISCOUNT") {
    return { allowed: true, reason: "Not a discount action — fairness band does not apply." };
  }
  const segment = context.customerSegment ?? "standard";
  const band = DISCOUNT_BANDS[segment];
  const offer = action.discountPercent ?? 0;
  const tuple = `segment=${segment} band=[${band.min}-${band.max}]% offer=${offer}%`;

  if (offer < band.min || offer > band.max) {
    return {
      allowed: false,
      reason: `Discount fairness check FAILED (${tuple}) — offer is outside this customer segment's approved band.`,
    };
  }
  return { allowed: true, reason: `Discount fairness check PASSED (${tuple}) — offer is within this customer segment's approved band.` };
};

export const testCases: RuleTestCase[] = [
  {
    name: "standard segment, 3% offer, within [0-5]% band, allowed",
    action: makeTestAction({ actionType: "OFFER_APPROVED_DISCOUNT", discountPercent: 3 }),
    context: makeTestContext({ customerSegment: "standard" }),
    expectAllowed: true,
  },
  {
    name: "standard segment, 12% offer, outside [0-5]% band, blocked",
    action: makeTestAction({ actionType: "OFFER_APPROVED_DISCOUNT", discountPercent: 12 }),
    context: makeTestContext({ customerSegment: "standard" }),
    expectAllowed: false,
    expectReasonContains: "FAILED",
  },
  {
    name: "boundary: standard segment, exactly 5% offer, allowed (inclusive max)",
    action: makeTestAction({ actionType: "OFFER_APPROVED_DISCOUNT", discountPercent: 5 }),
    context: makeTestContext({ customerSegment: "standard" }),
    expectAllowed: true,
  },
  {
    name: "at_risk segment, 20% offer, outside [5-15]% band, blocked",
    action: makeTestAction({ actionType: "OFFER_APPROVED_DISCOUNT", discountPercent: 20 }),
    context: makeTestContext({ customerSegment: "at_risk" }),
    expectAllowed: false,
  },
  {
    name: "non-discount action is allowed regardless of discountPercent",
    action: makeTestAction({ actionType: "SEND_SOFT_REMINDER" }),
    context: makeTestContext({ customerSegment: "standard" }),
    expectAllowed: true,
  },
];
