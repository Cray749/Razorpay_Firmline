// lib/ui/find-seed-record.ts — looks up a raw seed record by case id, for
// pages that need the original human-readable fields (name, amount, etc.)
// alongside the derived pipeline result.
import seedBatchJson from "@/data/seed/seeds/seed-v1.json";
import type { SeedBatch, PaymentFailure, CheckoutAbandonment, B2BReceivable } from "@/data/seed/schema";

const batch = seedBatchJson as SeedBatch;

export type SeedRecordLookup =
  | { recordType: "payment_failure"; record: PaymentFailure }
  | { recordType: "checkout_abandonment"; record: CheckoutAbandonment }
  | { recordType: "b2b_receivable"; record: B2BReceivable }
  | null;

export function findSeedRecord(caseId: string): SeedRecordLookup {
  const pf = batch.payment_failures.find((r) => r.id === caseId);
  if (pf) return { recordType: "payment_failure", record: pf };
  const ca = batch.checkout_abandonments.find((r) => r.id === caseId);
  if (ca) return { recordType: "checkout_abandonment", record: ca };
  const b2b = batch.b2b_receivables.find((r) => r.id === caseId);
  if (b2b) return { recordType: "b2b_receivable", record: b2b };
  return null;
}
