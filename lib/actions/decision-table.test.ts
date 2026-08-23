import { runSuite, check, checkEqual } from "@/lib/test-utils/harness";
import { decidePaymentFailureActions, decideB2BReceivableActions } from "./decision-table";
import { PAYMENT_FAILURE_ROOT_CAUSES, B2B_RECEIVABLE_ROOT_CAUSES, CHECKOUT_ABANDONMENT_ROOT_CAUSES } from "@/lib/classifier/types";
import type { PaymentFailure } from "@/data/seed/schema";

function makePf(overrides: Partial<PaymentFailure> = {}): PaymentFailure {
  return {
    id: "pf_0001",
    customer_id: "cust_1",
    customer_name: "Test User",
    customer_phone: "+919999900001",
    customer_email: "test@example.com",
    preferred_language: "en",
    amount_inr: 999,
    mandate_id: "mandate_1",
    mandate_max_amount_inr: 2000,
    mandate_expiry: "2027-01-01T00:00:00.000Z",
    failure_code: "INSUFFICIENT_FUNDS",
    attempted_at: "2026-08-10T10:00:00.000Z",
    previous_attempts_today: 0,
    previous_attempts_total_21d: 0,
    is_opted_out: false,
    is_disputed: false,
    last_contact_status: "NO_PRIOR_CONTACT",
    customer_segment: "standard",
    true_root_cause: "INSUFFICIENT_BALANCE",
    ...overrides,
  };
}

export default function run(): void {
  runSuite("every payment-failure/B2B/checkout root cause maps to at least one action", () => {
    for (const rc of [...PAYMENT_FAILURE_ROOT_CAUSES, ...B2B_RECEIVABLE_ROOT_CAUSES, ...CHECKOUT_ABANDONMENT_ROOT_CAUSES]) {
      const actions = decidePaymentFailureActions(makePf(), rc);
      check(actions.length >= 1, `root cause ${rc} must map to at least one action`);
    }
  });

  runSuite("proactive stop-loss: a retry-type action is substituted, never proposed, when threshold already hit", () => {
    const record = makePf({ previous_attempts_total_21d: 6, customer_segment: "standard" });
    const actions = decidePaymentFailureActions(record, "INSUFFICIENT_BALANCE");
    check(
      !actions.some((a) => a.actionType === "SCHEDULE_COMPLIANT_RETRY"),
      "must not propose a retry once previous_attempts_total_21d >= stop-loss threshold"
    );
    check(actions.some((a) => a.actionType === "STOP_AND_WRITE_OFF"), "standard segment should be substituted with STOP_AND_WRITE_OFF");
  });

  runSuite("proactive stop-loss: high-value customers get escalated to a human, not written off", () => {
    const record = makePf({ previous_attempts_total_21d: 7, customer_segment: "high_value" });
    const actions = decidePaymentFailureActions(record, "MANDATE_TIMING_VIOLATION");
    check(actions.some((a) => a.actionType === "ESCALATE_TO_HUMAN"), "high-value segment should be substituted with ESCALATE_TO_HUMAN");
    check(!actions.some((a) => a.actionType === "STOP_AND_WRITE_OFF"), "high-value segment should not be written off");
  });

  runSuite("below stop-loss threshold, retries are proposed normally", () => {
    const record = makePf({ previous_attempts_total_21d: 2 });
    const actions = decidePaymentFailureActions(record, "INSUFFICIENT_BALANCE");
    check(actions.some((a) => a.actionType === "SCHEDULE_COMPLIANT_RETRY"), "retry should be proposed when well under the threshold");
  });

  runSuite("output is a typed ProposedAction ready for the compliance gate", () => {
    const actions = decidePaymentFailureActions(makePf(), "INSUFFICIENT_BALANCE");
    const a = actions[0];
    checkEqual(a.caseId, "pf_0001", "caseId carried through");
    check(a.contactTarget !== null, "a contactable action must carry a contact target");
    check(a.proposedAt instanceof Date, "proposedAt must be a real Date, ready for Rule 1/8 checks");
  });

  runSuite("B2B decision table produces actions too", () => {
    const actions = decideB2BReceivableActions(
      { id: "b2b_0001", business_name: "Test Traders", contact_name: "A", contact_phone: "+919999900002", contact_email: "b@example.com", preferred_language: "en", invoice_amount_inr: 10000, invoice_due_date: "2026-07-01", days_overdue: 30, payment_history_pattern: "frequently_late", dispute_flag: false, is_opted_out: false, true_root_cause: "CASH_FLOW_DELAY" },
      "CASH_FLOW_DELAY",
      new Date("2026-08-10T10:00:00.000Z")
    );
    check(actions.some((a) => a.actionType === "OFFER_PAYMENT_PLAN"), "CASH_FLOW_DELAY should include OFFER_PAYMENT_PLAN");
    check(actions.some((a) => a.actionType === "CAPTURE_PROMISE_TO_PAY"), "CASH_FLOW_DELAY should include CAPTURE_PROMISE_TO_PAY");
  });

  console.log("decision-table.test.ts: all assertions passed");
}
