import { check } from "@/lib/test-utils/harness";
import { runPromiseLifecycle, resetPromiseTrackerForTests, isDiscountEligibilityRevoked, applyPromiseTrackerOverrides } from "./state-machine";
import { createRng } from "@/data/seed/rng";
import { resetAuditLogForTests, getAllAuditRowsSync } from "@/lib/audit/log";
import seedBatch from "@/data/seed/seeds/seed-v1.json";
import type { SeedBatch } from "@/data/seed/schema";
import { decideB2BReceivableActions } from "@/lib/actions/decision-table";

const batch = seedBatch as SeedBatch;

export default async function run(): Promise<void> {
  resetAuditLogForTests();
  resetPromiseTrackerForTests();

  const rng = createRng(777);
  const promiseEligible = batch.b2b_receivables.filter((r) => !r.dispute_flag && (r.payment_history_pattern === "frequently_late" || r.payment_history_pattern === "always_on_time"));
  check(promiseEligible.length >= 10, "sanity: enough B2B records to exercise both promise outcomes");

  let sawFulfilled = false;
  let sawBroken = false;
  let brokenCustomerId = "";

  for (const r of promiseEligible) {
    const outcome = await runPromiseLifecycle(r.id, r.business_name, r.payment_history_pattern, rng);
    if (outcome.finalState === "FULFILLED") sawFulfilled = true;
    if (outcome.finalState === "BROKEN") {
      sawBroken = true;
      brokenCustomerId = outcome.customerId;
    }
  }

  check(sawFulfilled, "at least one seeded case must reach FULFILLED");
  check(sawBroken, "at least one seeded case must reach BROKEN");

  check(isDiscountEligibilityRevoked(brokenCustomerId), "a broken-promise customer's discount eligibility must be revoked");

  const brokenRows = getAllAuditRowsSync().filter((r) => r.event_type === "promise_broken");
  check(brokenRows.length >= 1, "at least one promise_broken audit event must be logged");

  // Subsequent processing: a soft reminder proposed later for this same
  // customer must be overridden to ESCALATE_TO_HUMAN, not sent as-is.
  const laterActions = decideB2BReceivableActions(
    {
      id: "b2b_followup",
      business_name: brokenCustomerId,
      contact_name: "X",
      contact_phone: "+919999900099",
      contact_email: "x@example.com",
      preferred_language: "en",
      invoice_amount_inr: 5000,
      invoice_due_date: "2026-07-01",
      days_overdue: 45,
      payment_history_pattern: "frequently_late",
      dispute_flag: false,
      is_opted_out: false,
      true_root_cause: "OVERSIGHT",
    },
    "OVERSIGHT" // maps to SEND_SOFT_REMINDER
  );
  const overridden = applyPromiseTrackerOverrides(laterActions);
  check(
    !overridden.some((a) => a.actionType === "SEND_SOFT_REMINDER"),
    "a broken-promise customer must not receive an automated soft reminder on subsequent processing"
  );
  check(
    overridden.some((a) => a.actionType === "ESCALATE_TO_HUMAN"),
    "the suppressed soft reminder must be replaced with ESCALATE_TO_HUMAN"
  );

  console.log(`  PASS  promise lifecycle reaches both FULFILLED and BROKEN, broken customers are suppressed on later actions`);
  console.log("state-machine.test.ts: all assertions passed");
}
