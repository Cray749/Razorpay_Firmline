// lib/rules/test-fixtures.ts — sane defaults for a ProposedAction/CustomerContext
// pair that starts out compliant with every rule, so each rule's own test
// cases only need to override the one or two fields that rule actually cares
// about, rather than repeating a full object literal 13 times.
import type { ProposedAction } from "@/lib/actions/types";
import type { CustomerContext } from "./types";
import { fromZonedTime } from "date-fns-tz";
import { IST_TIME_ZONE } from "@/lib/time/ist";

// A Wednesday, 10:00 IST — inside the contact window (08:00-19:00) but NOT
// inside an NPCI non-peak band (10:00-13:00, 17:00-19:00 are peak), so tests
// that care about NPCI windows must deliberately pick a compliant time.
export const BASE_TIME = fromZonedTime("2026-08-12T13:00:00", IST_TIME_ZONE); // 13:00 IST: contact-window AND NPCI-non-peak

export function makeTestAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    actionType: "SEND_SOFT_REMINDER",
    caseId: "test_case_1",
    customerId: "test_customer_1",
    recordType: "payment_failure",
    rootCause: "INSUFFICIENT_BALANCE",
    contactTarget: { channel: "whatsapp", address: "+919999900001" },
    proposedAt: BASE_TIME,
    ...overrides,
  };
}

export function makeTestContext(overrides: Partial<CustomerContext> = {}): CustomerContext {
  return {
    customerId: "test_customer_1",
    isOptedOut: false,
    isDisputed: false,
    customerSegment: "standard",
    lastContactStatus: "NO_PRIOR_CONTACT",
    previousAttemptsTotal21d: 0,
    verifiedPhone: "+919999900001",
    verifiedEmail: "test@example.com",
    contactsTrailing24h: 0,
    contactsTrailing7d: 0,
    lastContactAt: null,
    preDebitNoticeSentAt: null,
    mandateChargeAttemptedTodayOnMandate: false,
    ...overrides,
  };
}
