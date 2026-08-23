// data/seed/constants.ts — shared constants between the generator and anything
// that needs to reference the seed version without importing generate.ts
// itself (which runs its generation `main()` as a side effect of being
// imported — keep that side effect confined to direct script execution only).
export const SEED_VALUE = 20260810;
export const SEED_VERSION_LABEL = "seed-v1";

// Thresholds for the deliberate Rule-9 (tone/content) demonstration subset —
// see lib/execution/message.ts, which routes records matching this exact
// predicate through a plain non-personalized/naive template rather than
// Claude, so Rule 9 has real, deterministic content to catch in the batch run
// regardless of Claude's (compliant-by-instruction) stochastic output.
export const TONE_DEMO_MIN_AMOUNT_INR = 500000;
export const TONE_DEMO_MIN_DAYS_OVERDUE = 90;
export function isToneDemoCase(record: { invoice_amount_inr: number; days_overdue: number }): boolean {
  return record.invoice_amount_inr >= TONE_DEMO_MIN_AMOUNT_INR && record.days_overdue >= TONE_DEMO_MIN_DAYS_OVERDUE;
}
