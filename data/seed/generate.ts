// data/seed/generate.ts — deterministic synthetic data generator for Firmline.
// Run with `npm run seed`. Same SEED constant -> byte-identical output every
// time (see data/seed/rng.ts). Writes data/seed/seeds/seed-v1.json and, if
// Supabase credentials are configured, loads the batch into Postgres too.
//
// Every timestamp in the generated data is computed relative to a FIXED
// anchor date (not wall-clock "now"), so the batch is reproducible even when
// re-run on a different calendar day.

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fromZonedTime } from "date-fns-tz";
import { createRng } from "./rng";
import { isWithinNpciNonPeakWindow, IST_TIME_ZONE, istCalendarDayKey } from "../../lib/time/ist";
import type {
  SeedBatch,
  PaymentFailure,
  CheckoutAbandonment,
  B2BReceivable,
  PreferredLanguage,
  CustomerSegment,
} from "./schema";
import { SEED_SCHEMA_VERSION } from "./schema";
import { getSupabaseClient } from "../../lib/supabase/client";
import { SEED_VALUE, SEED_VERSION_LABEL } from "./constants";

export { SEED_VALUE, SEED_VERSION_LABEL };

// All record timestamps are computed relative to this fixed anchor ("now" for
// the synthetic world), not actual wall-clock time, so the batch is fully
// reproducible regardless of what day the generator is actually run on.
const ANCHOR_IST = "2026-08-10T12:00:00";
const anchor = () => fromZonedTime(ANCHOR_IST, IST_TIME_ZONE);

function istAt(daysFromAnchor: number, hour: number, minute: number, second = 0): Date {
  const base = anchor();
  const d = new Date(base.getTime() + daysFromAnchor * 24 * 60 * 60 * 1000);
  // Rebuild via naive IST string so hour/minute reflect true IST wall-clock,
  // independent of DST-free IST's fixed +5:30 offset (no DST in India, so this
  // is safe, but we still go through fromZonedTime for consistency with lib/time/ist.ts).
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  // d here is a UTC instant; convert to an IST calendar date via the same
  // Date.UTC-based rollover trick used in lib/time/ist.ts, then rebuild at the
  // requested hour/minute in IST.
  const pad = (n: number) => String(n).padStart(2, "0");
  const calendarAnchor = new Date(Date.UTC(y, m, day));
  const iso = `${calendarAnchor.getUTCFullYear()}-${pad(calendarAnchor.getUTCMonth() + 1)}-${pad(
    calendarAnchor.getUTCDate()
  )}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
  return fromZonedTime(iso, IST_TIME_ZONE);
}

function dateOnly(daysFromAnchor: number): string {
  // IST midnight often falls on the previous UTC calendar day, so naively
  // slicing toISOString() gives the wrong date — use the tested IST calendar
  // helper instead (this is exactly the kind of bug lib/time/ist.ts exists to prevent).
  return istCalendarDayKey(istAt(daysFromAnchor, 12, 0));
}

// ---------------------------------------------------------------------------
// Name / contact pools
// ---------------------------------------------------------------------------
const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna",
  "Ishaan", "Rohan", "Ananya", "Diya", "Saanvi", "Aadhya", "Kavya", "Myra",
  "Priya", "Neha", "Pooja", "Riya", "Karan", "Rahul", "Amit", "Vikram",
  "Sneha", "Anjali", "Divya", "Meera", "Suresh", "Ramesh",
];
const LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Iyer", "Nair", "Reddy", "Rao", "Kumar",
  "Patel", "Shah", "Mehta", "Joshi", "Singh", "Chauhan", "Kapoor", "Bose",
  "Menon", "Pillai", "Desai", "Agarwal",
];
const BUSINESS_SUFFIXES = ["Traders", "Enterprises", "Textiles", "Logistics", "Retail Pvt Ltd", "Industries", "Solutions", "Foods", "Exports", "Distributors"];
const BUSINESS_PREFIXES = ["Shree", "Om", "National", "United", "Metro", "Sundar", "Ganesh", "Bharat", "Anand", "Krishna"];

function makePersonName(rng: ReturnType<typeof createRng>): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}
function makeBusinessName(rng: ReturnType<typeof createRng>): string {
  return `${rng.pick(BUSINESS_PREFIXES)} ${rng.pick(BUSINESS_SUFFIXES)}`;
}
function makePhone(rng: ReturnType<typeof createRng>): string {
  return `+91${rng.int(70000, 99999)}${rng.int(10000, 99999)}`;
}
function makeEmail(name: string, idx: number): string {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
  return `${slug}.${idx}@example.com`;
}
function pickLanguage(rng: ReturnType<typeof createRng>): PreferredLanguage {
  return rng.bool(0.45) ? "hi-en" : "en";
}
function pickSegment(rng: ReturnType<typeof createRng>): CustomerSegment {
  const r = rng.next();
  if (r < 0.15) return "high_value";
  if (r < 0.4) return "at_risk";
  return "standard";
}

// ---------------------------------------------------------------------------
// Payment failures
// ---------------------------------------------------------------------------
const PF_TOTAL = 84;
const PF_GATEWAY_CLUSTER_SIZE = 13; // circuit breaker: >=12 required, clustered in one 15-min window
const PF_CLUSTER_DAY_OFFSET = -3; // a day dedicated solely to the cluster; no filler records placed on this day/window

type PfPlan = {
  outsideWindow: boolean;
  npciPeak: boolean;
  freqCap: boolean; // previous_attempts_today >= 3
  isCluster: boolean;
  optOut: boolean;
  disputed: boolean;
  bounced: boolean;
  stopLoss: boolean; // previous_attempts_total_21d >= 5
  highValueDiscountDemo: boolean;
};

function classifyPfGroundTruth(
  failureCode: PaymentFailure["failure_code"],
  attemptedAt: Date,
  previousAttemptsToday: number,
  mandateExpiry: Date,
  isDisputed: boolean,
  rng: ReturnType<typeof createRng>
): string {
  // Mirrors lib/classifier/payment-failures.ts's decision-tree PRIORITY ORDER
  // (Phase 5 of BUILD_MANUAL.md) exactly, so ground truth agrees with what a
  // correctly-implemented classifier should output on the confident branches.
  // The one place real ambiguity (and thus real classifier error) is allowed
  // to exist is the UNKNOWN failure_code branch, which the rule-based
  // classifier can't resolve and must escalate to the Claude fallback.
  if (isDisputed) return "NEEDS_HUMAN_REVIEW";
  if (failureCode === "INSUFFICIENT_FUNDS") return "INSUFFICIENT_BALANCE";
  if (!isWithinNpciNonPeakWindow(attemptedAt)) return "MANDATE_TIMING_VIOLATION";
  if (previousAttemptsToday >= 1) return "MANDATE_TIMING_VIOLATION";
  if (failureCode === "MANDATE_EXPIRED" || mandateExpiry < attemptedAt) return "MANDATE_EXPIRED_OR_REVOKED";
  if (failureCode === "RISK_DECLINED") return "BANK_RISK_DECLINE";
  if (failureCode === "PIN_INCORRECT") return "INCORRECT_CREDENTIALS";
  if (failureCode === "GATEWAY_TIMEOUT") return "RAIL_OUTAGE";
  // UNKNOWN failure_code: genuinely ambiguous ground truth, deliberately hard.
  return rng.pick(["GATEWAY_TECHNICAL_ERROR", "GATEWAY_TECHNICAL_ERROR", "INCORRECT_CREDENTIALS", "BANK_RISK_DECLINE"]);
}

function generatePaymentFailures(rng: ReturnType<typeof createRng>): PaymentFailure[] {
  const records: PaymentFailure[] = [];

  // Build a plan array: guarantee every quota, then let the remainder be plain filler.
  const plans: PfPlan[] = [];
  const nonClusterCount = PF_TOTAL - PF_GATEWAY_CLUSTER_SIZE;
  for (let i = 0; i < nonClusterCount; i++) {
    plans.push({
      outsideWindow: false, npciPeak: false, freqCap: false, isCluster: false,
      optOut: false, disputed: false, bounced: false, stopLoss: false, highValueDiscountDemo: false,
    });
  }
  const setFlag = (key: keyof PfPlan, count: number) => {
    const idxs = rng.shuffle([...Array(nonClusterCount).keys()]).slice(0, count);
    for (const i of idxs) plans[i][key] = true;
  };
  setFlag("outsideWindow", 22);
  setFlag("npciPeak", 16);
  setFlag("freqCap", 12);
  setFlag("optOut", 6);
  setFlag("disputed", 9);
  setFlag("bounced", 9);
  setFlag("stopLoss", 7);
  setFlag("highValueDiscountDemo", 12);
  for (let i = 0; i < PF_GATEWAY_CLUSTER_SIZE; i++) {
    plans.push({
      outsideWindow: false, npciPeak: false, freqCap: false, isCluster: true,
      optOut: false, disputed: false, bounced: false, stopLoss: false, highValueDiscountDemo: false,
    });
  }

  let idx = 0;
  for (const plan of plans) {
    idx++;
    const name = makePersonName(rng);
    const customerId = `cust_pf_${String(idx).padStart(4, "0")}`;

    let attemptedAt: Date;
    let failureCode: PaymentFailure["failure_code"];
    if (plan.isCluster) {
      // All cluster records land inside one dedicated 15-minute window, on a day
      // no other PF record is scheduled on, so the circuit breaker sees a clean spike.
      const minuteOffset = rng.int(0, 14);
      attemptedAt = istAt(PF_CLUSTER_DAY_OFFSET, 10, minuteOffset, rng.int(0, 59));
      failureCode = "GATEWAY_TIMEOUT";
    } else {
      // Spread general records across the 28 days before the anchor, EXCLUDING
      // the cluster's dedicated day so no filler record dilutes/pollutes that window.
      let d = rng.int(-28, -1);
      if (d === PF_CLUSTER_DAY_OFFSET) d -= 1;
      if (plan.outsideWindow) {
        // Before 08:00 or after 19:00 IST.
        attemptedAt = rng.bool(0.5) ? istAt(d, rng.int(0, 7), rng.int(0, 59)) : istAt(d, rng.int(19, 23), rng.int(0, 59));
      } else if (plan.npciPeak) {
        // Inside contact window AND inside an NPCI peak sub-range: 10:00-13:00 or 17:00-19:00.
        attemptedAt = rng.bool(0.5) ? istAt(d, rng.int(10, 12), rng.int(0, 59)) : istAt(d, rng.int(17, 18), rng.int(0, 59));
      } else {
        // Plain, compliant time: within contact window AND within an NPCI non-peak band.
        attemptedAt = rng.bool(0.5) ? istAt(d, rng.int(8, 9), rng.int(0, 59)) : istAt(d, rng.int(13, 16), rng.int(0, 59));
      }
      const codeRoll = rng.next();
      failureCode =
        codeRoll < 0.38 ? "INSUFFICIENT_FUNDS" :
        codeRoll < 0.53 ? "RISK_DECLINED" :
        codeRoll < 0.63 ? "MANDATE_EXPIRED" :
        codeRoll < 0.73 ? "PIN_INCORRECT" :
        codeRoll < 0.85 ? "GATEWAY_TIMEOUT" :
        "UNKNOWN";
    }

    const previousAttemptsToday = plan.freqCap ? rng.int(3, 5) : plan.isCluster ? 0 : rng.int(0, 1);
    const previousAttemptsTotal21d = plan.stopLoss
      ? rng.int(5, 8)
      : Math.max(previousAttemptsToday, rng.int(0, 3));
    const amount = rng.int(299, 24999);
    const mandateExpiry = istAt(rng.int(10, 400), 0, 0); // usually well in the future
    const isDisputed = plan.disputed;

    const trueRootCause = classifyPfGroundTruth(
      failureCode, attemptedAt, previousAttemptsToday, mandateExpiry, isDisputed, rng
    );

    records.push({
      id: `pf_${String(idx).padStart(4, "0")}`,
      customer_id: customerId,
      customer_name: name,
      customer_phone: makePhone(rng),
      customer_email: makeEmail(name, idx),
      preferred_language: pickLanguage(rng),
      amount_inr: amount,
      mandate_id: `mandate_${String(idx).padStart(4, "0")}`,
      mandate_max_amount_inr: amount + rng.int(0, 5000),
      mandate_expiry: mandateExpiry.toISOString(),
      failure_code: failureCode,
      attempted_at: attemptedAt.toISOString(),
      previous_attempts_today: previousAttemptsToday,
      previous_attempts_total_21d: previousAttemptsTotal21d,
      is_opted_out: plan.optOut,
      is_disputed: isDisputed,
      last_contact_status: plan.bounced ? "FAILED_INVALID_NUMBER" : rng.bool(0.4) ? "DELIVERED" : "NO_PRIOR_CONTACT",
      customer_segment: plan.highValueDiscountDemo ? "high_value" : pickSegment(rng),
      true_root_cause: trueRootCause,
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Checkout abandonment
// ---------------------------------------------------------------------------
const CA_TOTAL = 58;

function classifyCaGroundTruth(
  timeOnPage: number,
  sessions: number,
  methodAttempted: string | null,
  cartValue: number,
  rng: ReturnType<typeof createRng>
): string {
  if (methodAttempted !== null && timeOnPage > 60) return "TECHNICAL_ERROR";
  if (sessions >= 3 && cartValue > 3000) return "PRICE_SENSITIVITY";
  if (methodAttempted === null && timeOnPage < 20) return "COMPARISON_SHOPPING";
  if (sessions === 1 && timeOnPage < 30) return "TRUST_SIGNAL_GAP";
  if (methodAttempted !== null) return "PAYMENT_METHOD_FRICTION";
  return rng.pick(["PRICE_SENSITIVITY", "COMPARISON_SHOPPING", "TRUST_SIGNAL_GAP"]);
}

function generateCheckoutAbandonments(rng: ReturnType<typeof createRng>): CheckoutAbandonment[] {
  const records: CheckoutAbandonment[] = [];
  const optOutIdxs = new Set(rng.shuffle([...Array(CA_TOTAL).keys()]).slice(0, 2));
  const outsideWindowIdxs = new Set(rng.shuffle([...Array(CA_TOTAL).keys()]).slice(0, 3));

  for (let i = 1; i <= CA_TOTAL; i++) {
    const name = makePersonName(rng);
    const d = rng.int(-28, -1);
    const abandonedAt = outsideWindowIdxs.has(i - 1)
      ? (rng.bool(0.5) ? istAt(d, rng.int(0, 7), rng.int(0, 59)) : istAt(d, rng.int(19, 23), rng.int(0, 59)))
      : istAt(d, rng.int(8, 18), rng.int(0, 59));
    const methods: (string | null)[] = [null, "upi", "card", "netbanking", "wallet"];
    const methodAttempted = rng.pick(methods);
    const timeOnPage = rng.int(3, 240);
    const sessions = rng.int(1, 5);
    const cartValue = rng.int(299, 45000);

    records.push({
      id: `ca_${String(i).padStart(4, "0")}`,
      customer_id: `cust_ca_${String(i).padStart(4, "0")}`,
      customer_name: name,
      customer_phone: makePhone(rng),
      customer_email: makeEmail(name, 10000 + i),
      preferred_language: pickLanguage(rng),
      cart_value_inr: cartValue,
      time_on_payment_page_sec: timeOnPage,
      sessions_count: sessions,
      payment_method_attempted: methodAttempted,
      abandoned_at: abandonedAt.toISOString(),
      is_opted_out: optOutIdxs.has(i - 1),
      customer_segment: pickSegment(rng),
      true_root_cause: classifyCaGroundTruth(timeOnPage, sessions, methodAttempted, cartValue, rng),
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// B2B receivables
// ---------------------------------------------------------------------------
const B2B_TOTAL = 58;
const B2B_FREQUENTLY_LATE_NO_DISPUTE = 10; // Rule: diagnosis ambiguity — must map to CASH_FLOW_DELAY, not INVOICE_DISPUTE

// Thresholds for the deliberate Rule-9 (tone/content) demonstration subset —
// see lib/claude/generate-message.ts, which routes records matching this exact
// predicate through a plain non-personalized template rather than Claude, so
// Rule 9 has real, deterministic content to catch in the batch run regardless
// of Claude's (compliant-by-instruction) stochastic output.
export const TONE_DEMO_MIN_AMOUNT_INR = 500000;
export const TONE_DEMO_MIN_DAYS_OVERDUE = 90;
export function isToneDemoCase(record: Pick<B2BReceivable, "invoice_amount_inr" | "days_overdue">): boolean {
  return record.invoice_amount_inr >= TONE_DEMO_MIN_AMOUNT_INR && record.days_overdue >= TONE_DEMO_MIN_DAYS_OVERDUE;
}

function classifyB2bGroundTruth(pattern: B2BReceivable["payment_history_pattern"], disputeFlag: boolean): string {
  // Mirrors lib/classifier/b2b-receivables.ts exactly. Exhaustive over
  // (dispute_flag, payment_history_pattern) — no random fallback needed, since
  // payment_history_pattern only ever takes these three values.
  if (disputeFlag) return "INVOICE_DISPUTE";
  if (pattern === "frequently_late") return "CASH_FLOW_DELAY"; // the deliberately-ambiguous pair the manual calls out
  if (pattern === "first_invoice") return "OVERSIGHT";
  return "APPROVAL_CHAIN_DELAY"; // always_on_time
}

function generateB2BReceivables(rng: ReturnType<typeof createRng>): B2BReceivable[] {
  const records: B2BReceivable[] = [];
  const patterns: B2BReceivable["payment_history_pattern"][] = ["always_on_time", "frequently_late", "first_invoice"];
  const optOutIdxs = new Set(rng.shuffle([...Array(B2B_TOTAL).keys()]).slice(0, 2));
  const disputedIdxs = new Set(rng.shuffle([...Array(B2B_TOTAL).keys()]).slice(0, 6));
  const frequentlyLateNoDisputeIdxs = rng.shuffle(
    [...Array(B2B_TOTAL).keys()].filter((i) => !disputedIdxs.has(i))
  ).slice(0, B2B_FREQUENTLY_LATE_NO_DISPUTE);
  const frequentlyLateSet = new Set(frequentlyLateNoDisputeIdxs);
  // Reserve 5 slots for the tone/content demonstration cases (Rule 9).
  const toneDemoIdxs = new Set(
    rng.shuffle([...Array(B2B_TOTAL).keys()].filter((i) => !disputedIdxs.has(i))).slice(0, 5)
  );

  for (let i = 1; i <= B2B_TOTAL; i++) {
    const idx0 = i - 1;
    const businessName = makeBusinessName(rng);
    const contactName = makePersonName(rng);
    const isDisputed = disputedIdxs.has(idx0);
    const pattern = frequentlyLateSet.has(idx0) ? "frequently_late" : rng.pick(patterns);
    const daysOverdue = toneDemoIdxs.has(idx0) ? rng.int(TONE_DEMO_MIN_DAYS_OVERDUE, 180) : rng.int(1, 89);
    const invoiceAmount = toneDemoIdxs.has(idx0) ? rng.int(TONE_DEMO_MIN_AMOUNT_INR, 2000000) : rng.int(5000, 499999);
    const dueDate = dateOnly(-daysOverdue);

    records.push({
      id: `b2b_${String(i).padStart(4, "0")}`,
      business_name: businessName,
      contact_name: contactName,
      contact_phone: makePhone(rng),
      contact_email: makeEmail(contactName, 20000 + i),
      preferred_language: pickLanguage(rng),
      invoice_amount_inr: invoiceAmount,
      invoice_due_date: dueDate,
      days_overdue: daysOverdue,
      payment_history_pattern: pattern,
      dispute_flag: isDisputed,
      is_opted_out: optOutIdxs.has(idx0),
      true_root_cause: classifyB2bGroundTruth(pattern, isDisputed),
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Validation summary
// ---------------------------------------------------------------------------
function printSummary(batch: SeedBatch) {
  const pf = batch.payment_failures;
  const ca = batch.checkout_abandonments;
  const b2b = batch.b2b_receivables;

  const isOutsideContactWindow = (iso: string) => {
    const d = new Date(iso);
    const h = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: IST_TIME_ZONE, hour: "2-digit", hour12: false }).format(d)
    );
    return h < 8 || h >= 19;
  };

  const checks: Array<{ label: string; min: number; count: number; rule: string }> = [
    {
      label: "PF: attempted_at outside 8AM-7PM IST",
      min: 20,
      rule: "Rule 1",
      count: pf.filter((r) => isOutsideContactWindow(r.attempted_at)).length,
    },
    {
      label: "PF: same customer 3+ same-day attempts (previous_attempts_today>=3)",
      min: 10,
      rule: "Rule 2",
      count: pf.filter((r) => r.previous_attempts_today >= 3).length,
    },
    {
      label: "PF+CA+B2B: opted out",
      min: 8,
      rule: "Rule 4",
      count: pf.filter((r) => r.is_opted_out).length + ca.filter((r) => r.is_opted_out).length + b2b.filter((r) => r.is_opted_out).length,
    },
    {
      label: "PF: mandate retry candidates with no prior pre-debit notice (proxy: INSUFFICIENT_FUNDS-derived or MANDATE_TIMING_VIOLATION ground truth)",
      min: 15,
      rule: "Rule 6",
      count: pf.filter((r) => r.true_root_cause === "INSUFFICIENT_BALANCE" || r.true_root_cause === "MANDATE_TIMING_VIOLATION").length,
    },
    {
      label: "PF: previous_attempts_today>=1 on a mandate (same-day duplicate charge candidates)",
      min: 5,
      rule: "Rule 7",
      count: pf.filter((r) => r.previous_attempts_today >= 1).length,
    },
    {
      label: "PF: attempted_at inside an NPCI peak window",
      min: 15,
      rule: "Rule 8",
      count: pf.filter((r) => !isWithinNpciNonPeakWindow(new Date(r.attempted_at))).length,
    },
    {
      label: "B2B: high-amount + long-overdue (tone/content demo subset)",
      min: 5,
      rule: "Rule 9",
      count: b2b.filter((r) => isToneDemoCase(r)).length,
    },
    {
      label: "PF: high_value segment customers",
      min: 10,
      rule: "Rule 10",
      count: pf.filter((r) => r.customer_segment === "high_value").length,
    },
    {
      label: "PF: previous_attempts_total_21d>=5 (stop-loss)",
      min: 6,
      rule: "Rule 11",
      count: pf.filter((r) => r.previous_attempts_total_21d >= 5).length,
    },
    {
      label: "PF: last_contact_status FAILED_INVALID_NUMBER",
      min: 8,
      rule: "Rule 12",
      count: pf.filter((r) => r.last_contact_status === "FAILED_INVALID_NUMBER").length,
    },
    {
      label: "PF: is_disputed",
      min: 8,
      rule: "Rule 13",
      count: pf.filter((r) => r.is_disputed).length,
    },
    {
      label: "PF: clustered GATEWAY_TIMEOUT (circuit breaker)",
      min: 12,
      rule: "Circuit breaker",
      count: pf.filter((r) => r.failure_code === "GATEWAY_TIMEOUT" && istCalendarDayKey(new Date(r.attempted_at)) === dateOnly(PF_CLUSTER_DAY_OFFSET)).length,
    },
    {
      label: "B2B: frequently_late + no dispute (should classify CASH_FLOW_DELAY not INVOICE_DISPUTE)",
      min: 10,
      rule: "Diagnosis accuracy",
      count: b2b.filter((r) => r.payment_history_pattern === "frequently_late" && !r.dispute_flag).length,
    },
  ];

  console.log("\n=== Firmline seed edge-case validation ===");
  console.log(`Total: ${pf.length + ca.length + b2b.length} (PF ${pf.length} / CA ${ca.length} / B2B ${b2b.length})\n`);
  let allOk = true;
  for (const c of checks) {
    const ok = c.count >= c.min;
    if (!ok) allOk = false;
    console.log(`  [${ok ? "OK" : "FAIL"}] ${c.rule.padEnd(18)} ${c.label}: ${c.count} (min ${c.min})`);
  }
  console.log("");
  if (!allOk) {
    throw new Error("Seed generation failed: at least one edge-case minimum was not met. Fix the generator before proceeding.");
  }
  console.log("All edge-case minimums met.\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const rng = createRng(SEED_VALUE);
  const payment_failures = generatePaymentFailures(rng);
  const checkout_abandonments = generateCheckoutAbandonments(rng);
  const b2b_receivables = generateB2BReceivables(rng);

  const batch: SeedBatch = {
    schema_version: SEED_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    random_seed: SEED_VALUE,
    payment_failures,
    checkout_abandonments,
    b2b_receivables,
  };

  printSummary(batch);

  const outDir = path.resolve(__dirname, "seeds");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${SEED_VERSION_LABEL}.json`);
  writeFileSync(outPath, JSON.stringify(batch, null, 2));
  console.log(`Wrote ${outPath}`);

  const client = getSupabaseClient();
  if (!client) {
    console.warn(
      "[seed] Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY missing) — skipping DB load. " +
        "Run `npm run seed` again once .env.local is filled in to load this batch into Postgres."
    );
    return;
  }

  console.log("[seed] Loading batch into Supabase...");
  const tables: Array<[string, unknown[]]> = [
    ["payment_failures", payment_failures],
    ["checkout_abandonments", checkout_abandonments],
    ["b2b_receivables", b2b_receivables],
  ];
  for (const [table, rows] of tables) {
    // Clear any previous load of this seed version, then insert fresh.
    const { error: delError } = await client.from(table).delete().neq("id", "__never__");
    if (delError) console.warn(`[seed] warning clearing ${table}:`, delError.message);
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await client.from(table).insert(chunk as never);
      if (error) {
        console.error(`[seed] FAILED inserting into ${table}:`, error.message);
        process.exitCode = 1;
      }
    }
    console.log(`[seed] loaded ${rows.length} rows into ${table}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
