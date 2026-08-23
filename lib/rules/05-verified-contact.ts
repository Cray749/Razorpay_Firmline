// lib/rules/05-verified-contact.ts — RBI ban on third-party contact: the
// channel/address on the proposed action must exactly match the customer's
// own verified phone or email as generated in the seed data. Any mismatch —
// even an innocent one, e.g. a secondary number picked up elsewhere — is a
// hard reject, never "close enough."
import type { ComplianceRule, RuleResult, RuleTestCase } from "./types";
import { makeTestAction, makeTestContext } from "./test-fixtures";

export const checkVerifiedContact: ComplianceRule = (action, context): RuleResult => {
  if (!action.contactTarget) {
    return { allowed: true, reason: "This action has no direct customer contact — verified-contact check does not apply." };
  }
  const { address } = action.contactTarget;
  const matchesPhone = context.verifiedPhone !== null && address === context.verifiedPhone;
  const matchesEmail = context.verifiedEmail !== null && address === context.verifiedEmail;
  if (matchesPhone || matchesEmail) {
    return { allowed: true, reason: "Contact target matches the customer's verified phone/email on file." };
  }
  return {
    allowed: false,
    reason: `Contact target "${address}" does not match this customer's verified phone or email on file — refusing to contact an unverified address.`,
  };
};

export const testCases: RuleTestCase[] = [
  {
    name: "contact target matching verified phone is allowed",
    action: makeTestAction({ contactTarget: { channel: "whatsapp", address: "+919999900001" } }),
    context: makeTestContext({ verifiedPhone: "+919999900001", verifiedEmail: "test@example.com" }),
    expectAllowed: true,
  },
  {
    name: "contact target matching verified email is allowed",
    action: makeTestAction({ contactTarget: { channel: "email", address: "test@example.com" } }),
    context: makeTestContext({ verifiedPhone: "+919999900001", verifiedEmail: "test@example.com" }),
    expectAllowed: true,
  },
  {
    name: "mismatched contact target is blocked",
    action: makeTestAction({ contactTarget: { channel: "email", address: "someone-else@example.com" } }),
    context: makeTestContext({ verifiedPhone: "+919999900001", verifiedEmail: "test@example.com" }),
    expectAllowed: false,
    expectReasonContains: "does not match",
  },
  {
    name: "no contact target (e.g. internal escalation) is allowed",
    action: makeTestAction({ contactTarget: null }),
    context: makeTestContext(),
    expectAllowed: true,
  },
];
