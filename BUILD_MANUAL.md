# Firmline — Autonomous Build Manual

## Read this first, before Phase 0

This document is written to be given, in full, to a fresh Claude Code session as the first message, with the instruction: *"Follow this manual exactly, in order. Build Firmline."* It is written to be followed by an AI agent working largely without a human in the loop, so it is more explicit and more repetitive than a manual written for a human team would need to be. That repetition is deliberate — do not skip steps because they seem obvious from context established earlier in the session.

If you are the AI agent reading this: treat every **Definition of Done** as a hard gate. Do not proceed to the next phase until you have verified it yourself — run the actual test, read the actual output, don't assume. If a Definition of Done cannot be satisfied, stop, write the reason to `docs/BLOCKERS.md`, and continue with the next independent phase rather than silently proceeding on a broken foundation.

If you are the human: you don't need to do anything mid-build. Your job is Phase 0 (paste your API keys), and your job again once you get a message that Phase 20 (final verification) is complete.

---

## 0. Project identity

- Name: **Firmline**
- One-line description: an AI agent that diagnoses revenue-at-risk (failed payments, abandoned checkouts, overdue invoices), decides on a bounded recovery action, checks that action against a deterministic compliance engine, executes it, and logs everything.
- Built for: Razorpay AI Buildathon, Track 03 — AI Revenue Recovery.
- Solo builder, using Claude Code as the primary build tool, on a Claude Pro plan.

---

## 1. Session and resumability protocol — read before doing anything else

This build will very likely span more than one Claude Code session, because a Pro plan's 5-hour session window is real and this is a genuinely large build. The manual is structured so a fresh session can resume cleanly with zero lost context, **as long as you follow this protocol exactly.**

**At the start of any session:**
1. Read `docs/PROGRESS.md`. If it doesn't exist, this is session 1 — create it now with the template below.
2. Find the last phase marked `DONE`. Resume at the next phase, not from the beginning.
3. Re-read that phase's Definition of Done before writing any new code, to re-establish exactly what "done" means for it.

**`docs/PROGRESS.md` template (create this literally first, before any other file):**

```markdown
# Firmline build progress

Last updated: <timestamp, IST>

## Phase log
| Phase | Status | Notes |
|---|---|---|
| 0 | DONE | Project identity, this file created |
| 1 | DONE | Resumability protocol established |
| 2 | NOT_STARTED | |
...

## Known blockers
(none yet)

## Environment variables confirmed present
- [ ] NEXT_PUBLIC_SUPABASE_URL
- [ ] NEXT_PUBLIC_SUPABASE_ANON_KEY
- [ ] ANTHROPIC_API_KEY
- [ ] RAZORPAY_TEST_KEY_ID
- [ ] RAZORPAY_TEST_KEY_SECRET
```

**At the end of any session** (whether ending because a phase is complete, because you're running low on context, or for any other reason): update `docs/PROGRESS.md` with the current state before doing anything else, including recording a phase as `IN_PROGRESS` with a note on exactly what's left, so a future session doesn't have to re-derive it. Commit and push. This single habit is what makes the whole manual resumable — treat it as non-negotiable, not a nice-to-have.

---

## 2. What we will NOT build — scope discipline

- No real money moves. Synthetic data and Razorpay test-mode APIs only.
- No real outbound messages to real phone numbers or email addresses. Everything is simulated in the UI, with one exception: real Razorpay test-mode payment link generation (Phase 12), because that's a safe, free, test-mode API call.
- No login system, no multi-tenant accounts, no billing. Single demo instance.
- No open-ended agent behavior. The AI never invents a new action type or a new compliance rule at runtime. Every action comes from the fixed list. This is a design principle, not a shortcut.
- No fraud detection, no chargeback handling. That's Track 02. Stay in Track 03's lane.
- Do not gold-plate any one phase at the expense of finishing the pipeline end to end. A complete, working, plainly-built pipeline beats a beautifully over-engineered single layer with nothing downstream of it. If you find yourself spending disproportionate time polishing one phase, stop, mark it `DONE` at "good enough," and move on — you can return to polish in Phase 19 if time remains.

---

## 3. Definition of done for the whole project

Tied to what Razorpay actually judges (a public repo, a working thing, a 5-minute video, the architecture):

1. A batch run works end to end on the full synthetic dataset — not a cherry-picked example — with real computed numbers at the end.
2. The compliance gate visibly blocks or reschedules a meaningful number of actions in that same run.
3. Every case has an audit trail readable by a human with zero code knowledge.
4. `docs/architecture.md` exists and matches this manual's design.
5. README has real numbers, not `TBD`, by the end of the build.
6. It's deployed and reachable at a URL with no login required.

---

## 4. Tech stack (fixed, do not deviate mid-build)

| Piece | Choice |
|---|---|
| Frontend + API | Next.js 14, App Router, TypeScript, Tailwind CSS |
| Database | Supabase (Postgres), free tier |
| AI | Anthropic Claude API (Sonnet) |
| Charts | Recharts |
| Deployment | Vercel (app) + Supabase (DB) |

Do not introduce a second database, a second frontend framework, or a separate backend service mid-build even if a task seems to call for it. Solve it within this stack. If genuinely impossible within this stack, log it to `docs/BLOCKERS.md` and pick the closest achievable alternative rather than expanding scope.

---

## 5. Phase 0 — Environment setup

**Requires a human.** If any of the following are missing, stop and ask for them before proceeding; do not fabricate placeholder keys and continue, since that produces a build that looks done but silently fails at runtime.

1. Confirm a GitHub repo exists, is public, and is connected to Vercel for auto-deploy on push.
2. Confirm `.env.local` contains real values for: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`.
3. Confirm `.env.local` is listed in `.gitignore` before the first commit. Verify this by running `git check-ignore .env.local` and confirming it returns the path (meaning it is correctly ignored).
4. Confirm the same five variables are also set in the Vercel project's environment settings, not just locally — a deployment with local-only env vars will build but fail at runtime, which is a common and avoidable mistake.

**Definition of done:** `npm run dev` runs locally with no missing-key errors, and a blank Vercel deployment is live at a URL.

---

## 6. Phase 1 — Repo scaffold

```bash
npx create-next-app@latest firmline --typescript --tailwind --app --no-src-dir
cd firmline
npm install @supabase/supabase-js @anthropic-ai/sdk recharts date-fns-tz
```

Note `date-fns-tz` — this is deliberate and mandatory. All server-side time comparisons in the compliance engine must go through a single IST-aware utility, not raw `Date` objects, because the deploy server's local time zone (Vercel defaults to UTC) is not IST, and a compliance system that silently compares UTC wall-clock time against an "8 AM–7 PM" rule intended for IST will be wrong in exactly the way that's hardest to notice in a demo and easiest to notice if a judge checks a timestamp by hand.

Create the full folder structure now, with empty stub files, even before they have real logic:

```
firmline/
├── app/
│   ├── api/
│   │   ├── diagnose/route.ts
│   │   ├── decide/route.ts
│   │   ├── compliance/route.ts
│   │   ├── circuit-breaker/route.ts
│   │   ├── execute/route.ts
│   │   └── batch/route.ts
│   ├── dashboard/page.tsx
│   ├── case/[id]/page.tsx
│   └── counterfactual/page.tsx
├── lib/
│   ├── classifier/
│   │   ├── payment-failures.ts
│   │   ├── checkout-abandonment.ts
│   │   ├── b2b-receivables.ts
│   │   └── claude-fallback.ts
│   ├── rules/
│   │   ├── 01-contact-window.ts
│   │   ├── 02-frequency-cap.ts
│   │   ├── 03-cooling-off.ts
│   │   ├── 04-opt-out.ts
│   │   ├── 05-verified-contact.ts
│   │   ├── 06-pre-debit-notice.ts
│   │   ├── 07-one-charge-per-day.ts
│   │   ├── 08-npci-window.ts
│   │   ├── 09-tone-content.ts
│   │   ├── 10-discount-fairness.ts
│   │   ├── 11-stop-loss.ts
│   │   ├── 12-bounce-suppression.ts
│   │   ├── 13-dispute-freeze.ts
│   │   ├── gate.ts               # runs all 13, aggregates result
│   │   └── rules.test.ts         # shared test harness, see Phase 8
│   ├── circuit-breaker/
│   │   └── index.ts
│   ├── actions/
│   │   ├── decision-table.ts
│   │   └── types.ts
│   ├── time/
│   │   └── ist.ts                # single source of truth, see Phase 6.1
│   ├── claude/
│   │   ├── client.ts             # wraps the SDK, handles retries/failures — see Phase 6.2
│   │   ├── diagnose-fallback.ts
│   │   └── generate-message.ts
│   └── promise-tracker/
│       └── state-machine.ts
├── data/
│   └── seed/
│       ├── schema.ts             # locked schema, see Phase 5
│       ├── generate.ts
│       └── seeds/                # versioned output goes here, e.g. seed-v1.json
├── docs/
│   ├── PROGRESS.md
│   ├── BLOCKERS.md
│   ├── architecture.md
│   ├── design/
│   └── metrics/
└── README.md
```

**Definition of done:** this exact structure exists, `npm run dev` shows a placeholder homepage, first commit is pushed, Vercel preview URL loads.

---

## 6.1. The IST time utility — build this before anything that touches time

Create `lib/time/ist.ts` as the **only** place in the codebase allowed to do timezone-sensitive date math. Every rule, every scheduler, every timestamp comparison imports from here — never from raw `Date` or `new Date().getHours()` anywhere else in the codebase.

Required exports:
- `nowIST(): Date` — current time, correctly offset to IST regardless of server timezone.
- `isWithinContactWindow(t: Date): boolean` — true if `t` falls within 08:00–19:00 IST.
- `isWithinNpciNonPeakWindow(t: Date): boolean` — true if `t` falls within one of: before 10:00, 13:00–17:00, after 21:30 IST.
- `nextValidComplianceSlot(after: Date): Date` — given a floor timestamp, returns the next timestamp that satisfies **both** `isWithinContactWindow` and, if the action is an AutoPay retry, `isWithinNpciNonPeakWindow`. This is the function Rule 6 and Rule 8 both call — see Phase 8 for why this specific function is the fix for the rescheduling bug described there.

**Definition of done:** unit tests exist and pass for at least these cases: a timestamp at 11:45 PM correctly returns `false` from `isWithinContactWindow`; `nextValidComplianceSlot` given a floor of "tomorrow 11:45 PM" returns a timestamp inside tomorrow's valid window, not simply `floor + 0`; a timestamp exactly at 08:00:00 and exactly at 19:00:00 are both handled correctly (decide and document whether the boundary is inclusive or exclusive, then test that decision).

## 6.2. The Claude client wrapper — build this before any feature calls Claude

Create `lib/claude/client.ts` as the single wrapped entry point for all Claude API calls in this codebase. Do not call the Anthropic SDK directly from anywhere else.

Required behavior:
- Wraps every call in a try/catch.
- On failure (rate limit, timeout, network error, malformed response), does **not** throw and crash the batch run. Instead, returns a typed result: `{ success: false, reason: string }`.
- Callers (the diagnosis fallback, the message generator) must handle `success: false` by falling back to a safe default — for diagnosis, that means falling back to the lowest-confidence rule-based guess plus a flag marking it `NEEDS_HUMAN_REVIEW` rather than silently guessing; for message generation, that means falling back to a plain, pre-written, non-personalized template rather than blocking the whole record.
- Every call, successful or not, is logged with latency and outcome — this becomes part of the honesty of the audit trail. A project whose core thesis is "handle failure gracefully" cannot have its own AI calls be the one unhandled failure mode.

**Definition of done:** manually simulate a failure (e.g., temporarily point `ANTHROPIC_API_KEY` at an invalid value) and confirm the batch run completes without crashing, with the affected records correctly flagged rather than silently skipped or silently guessed.

---

## 7. Phase 2 — Data schema (lock this before writing the generator)

Create `data/seed/schema.ts` first, as TypeScript types, and treat it as a versioned contract. Once Phase 3 (classifier) is built against version 1 of this schema, do not change the schema without bumping the version and re-running every downstream test — schema drift between the data layer and the classifier is a silent-bug risk, not a hypothetical one.

```typescript
// data/seed/schema.ts — SCHEMA VERSION 1. Bump this comment and the SEED_SCHEMA_VERSION
// constant below if you ever change a field. Do not change fields silently.

export const SEED_SCHEMA_VERSION = 1;

export type PaymentFailure = {
  id: string;                    // e.g. "pf_0001"
  customer_id: string;
  customer_name: string;
  customer_phone: string;        // the ONE verified contact — used by Rule 5
  customer_email: string;
  preferred_language: "en" | "hi-en"; // hi-en = Hinglish
  amount_inr: number;
  mandate_id: string;
  mandate_max_amount_inr: number;
  mandate_expiry: string;        // ISO timestamp
  failure_code: "INSUFFICIENT_FUNDS" | "RISK_DECLINED" | "GATEWAY_TIMEOUT" | "MANDATE_EXPIRED" | "PIN_INCORRECT" | "UNKNOWN";
  attempted_at: string;          // ISO timestamp, IST — deliberately include some outside 8AM-7PM and inside NPCI peak windows
  previous_attempts_today: number;
  previous_attempts_total_21d: number;
  is_opted_out: boolean;
  is_disputed: boolean;          // triggers Rule 13 if true
  last_contact_status: "DELIVERED" | "FAILED_INVALID_NUMBER" | "NO_PRIOR_CONTACT"; // drives Rule 12
  customer_segment: "standard" | "at_risk" | "high_value"; // drives Rule 10 discount bands
  true_root_cause: string;       // ground truth label — NEVER passed to the classifier, only used for scoring
};

export type CheckoutAbandonment = {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  preferred_language: "en" | "hi-en";
  cart_value_inr: number;
  time_on_payment_page_sec: number;
  sessions_count: number;
  payment_method_attempted: string | null;
  abandoned_at: string;
  is_opted_out: boolean;
  customer_segment: "standard" | "at_risk" | "high_value";
  true_root_cause: string;
};

export type B2BReceivable = {
  id: string;
  business_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  preferred_language: "en" | "hi-en";
  invoice_amount_inr: number;
  invoice_due_date: string;
  days_overdue: number;
  payment_history_pattern: "always_on_time" | "frequently_late" | "first_invoice";
  dispute_flag: boolean;
  is_opted_out: boolean;
  true_root_cause: string;
};

export type SeedBatch = {
  schema_version: number;
  generated_at: string;
  random_seed: number;
  payment_failures: PaymentFailure[];
  checkout_abandonments: CheckoutAbandonment[];
  b2b_receivables: B2BReceivable[];
};
```

**Definition of done:** this file exists, compiles with no type errors, and is committed before `generate.ts` is written against it.

---

## 8. Phase 3 — Synthetic data generator

Build `data/seed/generate.ts` against the locked schema above. Use a **fixed random seed** (store it in the output, as shown in `SeedBatch.random_seed`) so re-runs are reproducible — this matters because your final metrics need to be traceable to a specific, reproducible batch, not a lucky one-off run.

**Target volume:** 200 total records, split roughly evenly across the three types.

**Required edge cases** (this is not optional — the compliance rules cannot be demonstrated as working if the data never triggers them):

| Edge case | Minimum count | Which rule it proves |
|---|---|---|
| Timestamped outside 8 AM–7 PM IST | 20 | Rule 1 |
| Same customer, 3+ same-day contact attempts already logged | 10 | Rule 2 |
| Customer on opt-out list | 8 | Rule 4 |
| Contact channel mismatched from verified contact | 5 | Rule 5 |
| Mandate retry scheduled with no prior pre-debit notice | 15 | Rule 6 |
| Same-day duplicate mandate charge attempt | 5 | Rule 7 |
| Timestamped inside an NPCI peak window | 15 | Rule 8 |
| A message that would contain flaggable tone if generated naively (seed a case with an extremely high overdue amount and long delay, likely to trigger urgency-language generation) | 5 | Rule 9 |
| High-value customer segment with a discount scenario | 10 | Rule 10 |
| Customer with 5+ prior failed attempts, no resolution | 6 | Rule 11 |
| `last_contact_status: "FAILED_INVALID_NUMBER"` | 8 | Rule 12 |
| `is_disputed: true` | 8 | Rule 13 |
| Clustered `GATEWAY_TIMEOUT` failures within a short synthetic time window (at least 15% of a 15-minute-window slice) | one deliberate cluster of 12+ records | Circuit breaker |
| B2B records with `payment_history_pattern: "frequently_late"` and no dispute (should map to `CASH_FLOW_DELAY`, not `INVOICE_DISPUTE`) | 10 | Diagnosis accuracy on a genuinely ambiguous pair |

After generation, write the output to `data/seed/seeds/seed-v1.json` and print a summary table to the console confirming the count of records hitting each edge case above — if any count is below the minimum, the generator has a bug or the randomization needs adjusting; fix it before moving on, don't proceed with weak seed data.

Load the seed into Supabase via a `npm run seed` script.

**Definition of done:** `npm run seed` runs deterministically (same seed value produces the same output on repeat runs), writes to Supabase, and the printed edge-case summary meets every minimum in the table above.

---

## 9. Phase 4 — Circuit breaker (build this before the classifier, since diagnosis depends on it)

Create `lib/circuit-breaker/index.ts`. This is stateful and batch-wide, which is why it's a separate module from the (stateless, per-record) compliance rules — do not implement this as compliance Rule 14; it belongs architecturally upstream of Diagnosis, watching the stream before individual records are even classified.

Logic:
- Maintain a rolling 15-minute window (by record timestamp, not wall-clock, since this runs against a batch of historical synthetic data) of processed payment-failure records.
- If more than 15% of records in that window have `failure_code === "GATEWAY_TIMEOUT"`, trip the breaker for that window.
- When tripped: do not send any of the affected records through Diagnosis/Decision/Compliance/Execution individually. Instead, write **one** audit log entry: `"Execution suspended: rail degradation detected, N records affected, window [start, end]"`, and mark all affected records with a status of `PAUSED_CIRCUIT_BREAKER`.
- After the tripped window, if the next window's failure rate drops back under threshold, resume normally — log a second single event noting resumption.

**Definition of done:** running the breaker against the deliberately clustered `GATEWAY_TIMEOUT` records seeded in Phase 3 correctly trips it, produces exactly one audit event (not one per record), and correctly resumes on the next clean window. Verify this by counting audit log rows for that batch of records — it must be a small constant number, not proportional to the cluster size.

---

## 10. Phase 5 — Diagnosis layer

### 10.1 Rule-based classifier (build first)

For payment failures (`lib/classifier/payment-failures.ts`), implement as a decision tree, in this priority order (check in this exact order — order matters because some conditions overlap):

```
1. if is_disputed: return NEEDS_HUMAN_REVIEW (Rule 13 will freeze it anyway, don't even try to diagnose a disputed case automatically)
2. if failure_code == "INSUFFICIENT_FUNDS": return INSUFFICIENT_BALANCE (high confidence)
3. if NOT isWithinNpciNonPeakWindow(attempted_at): return MANDATE_TIMING_VIOLATION (high confidence)
4. if previous_attempts_today >= 1 for this mandate_id: return MANDATE_TIMING_VIOLATION (high confidence, one-per-day rule)
5. if failure_code == "MANDATE_EXPIRED" or mandate_expiry < attempted_at: return MANDATE_EXPIRED_OR_REVOKED (high confidence)
6. if failure_code == "RISK_DECLINED": return BANK_RISK_DECLINE (high confidence)
7. if failure_code == "PIN_INCORRECT": return INCORRECT_CREDENTIALS (high confidence)
8. if failure_code == "GATEWAY_TIMEOUT": return RAIL_OUTAGE (medium confidence — this is also what the circuit breaker watches for in aggregate)
9. else: return GATEWAY_TECHNICAL_ERROR (low confidence — escalate to Claude fallback)
```

Attach a numeric confidence score to every classification (e.g., 0.9 for the "high confidence" branches, 0.5 for medium, 0.3 for low). Only classifications below a threshold (suggest 0.5) get escalated to the Claude fallback in 10.2.

Build the equivalent decision trees for checkout abandonment (`lib/classifier/checkout-abandonment.ts`, based on `time_on_payment_page_sec`, `sessions_count`, `payment_method_attempted`) and B2B receivables (`lib/classifier/b2b-receivables.ts`, based on `payment_history_pattern`, `dispute_flag`, `days_overdue`). Apply the same confidence-scoring discipline to both.

### 10.2 Claude fallback for low-confidence cases only

Use the wrapped client from Phase 6.2. System prompt requirements:
- List the exact taxonomy from the README. Claude must pick one of the fixed labels — validate the response against the enum in code, and if Claude returns anything outside the fixed list, treat that as a client failure and fall back per Phase 6.2's failure handling, don't silently accept an invented label.
- Require a one-sentence reasoning string alongside the label. Store this — it becomes part of the audit trail for that case.
- This call never receives any information about compliance rules. It diagnoses only. Keep the prompt narrowly scoped to that one job.

### 10.3 Measure it

Since `true_root_cause` is known for every record (Phase 3), compute real precision and recall per category once the full batch has been classified. Write the result to `docs/metrics/diagnosis_accuracy.json`. This file's existence and content is what makes the README's accuracy claim real rather than asserted.

**Definition of done:** every record in the batch (except records paused by the circuit breaker) receives a root cause label, a confidence score, and a reasoning string; `docs/metrics/diagnosis_accuracy.json` exists with real computed precision/recall per category; manually spot-check five records against their `true_root_cause` and confirm the reported accuracy is consistent with what you see.

---

## 11. Phase 6 — Decision layer

Build `lib/actions/decision-table.ts` as a lookup table, not a generator:

| Root cause | Default action |
|---|---|
| `INSUFFICIENT_BALANCE` | `SCHEDULE_COMPLIANT_RETRY` + `SEND_SOFT_REMINDER` |
| `MANDATE_TIMING_VIOLATION` | `SCHEDULE_COMPLIANT_RETRY` |
| `MANDATE_EXPIRED_OR_REVOKED` | `REQUEST_NEW_PAYMENT_METHOD` |
| `CARD_EXPIRED` | `REQUEST_NEW_PAYMENT_METHOD` |
| `BANK_RISK_DECLINE` | `ESCALATE_TO_HUMAN` |
| `RAIL_OUTAGE` | `SILENT_RETRY_LATER` |
| `INCORRECT_CREDENTIALS` | `SEND_SOFT_REMINDER` |
| `GATEWAY_TECHNICAL_ERROR` | `SILENT_RETRY_LATER` |
| `PRICE_SENSITIVITY` | `OFFER_APPROVED_DISCOUNT` |
| `PAYMENT_METHOD_FRICTION` | `SEND_SOFT_REMINDER` + `GENERATE_PAYMENT_LINK` |
| `TRUST_SIGNAL_GAP` | `SEND_SOFT_REMINDER` (no discount — a discount doesn't fix a trust problem) |
| `TECHNICAL_ERROR` | `GENERATE_PAYMENT_LINK` |
| `COMPARISON_SHOPPING` | `NO_ACTION_NEEDED` |
| `CASH_FLOW_DELAY` | `OFFER_PAYMENT_PLAN` + `CAPTURE_PROMISE_TO_PAY` |
| `INVOICE_DISPUTE` | `ESCALATE_TO_HUMAN` |
| `OVERSIGHT` | `SEND_SOFT_REMINDER` |
| `APPROVAL_CHAIN_DELAY` | `CAPTURE_PROMISE_TO_PAY` |
| `NEEDS_HUMAN_REVIEW` | `ESCALATE_TO_HUMAN` |

Before proposing any retry-type action, the Decision Layer must itself check the record's attempt count against the stop-loss threshold (proactively, in addition to Rule 11 catching it at the gate) — don't propose an action you already know the gate will reject; that's wasted work and a confusing audit trail (a "proposed but immediately blocked" entry reads worse than a "correctly never proposed" one).

**Definition of done:** every root cause in the taxonomy maps to a default action, the proactive stop-loss check is implemented, and the output is a typed `ProposedAction` object ready for the Compliance Gate.

---

## 12. Phase 7 — Promise-to-pay state machine

Build `lib/promise-tracker/state-machine.ts`:

```
PROMISED → DUE_DATE_PENDING → FULFILLED (close case, no further action)
                             → BROKEN   (revoke discount eligibility on this customer_id,
                                          force next action to ESCALATE_TO_HUMAN,
                                          write one audit event explaining why)
```

Any record whose action is `CAPTURE_PROMISE_TO_PAY` enters this state machine. In the synthetic batch, simulate outcomes (some promises fulfilled, some broken) using a fixed, documented probability tied to `payment_history_pattern` — don't leave this unspecified; a B2B record with `always_on_time` history should have a meaningfully higher fulfillment probability in the simulation than one with `frequently_late` history, and that mapping should be written down in code comments, not left implicit.

**Definition of done:** at least one seeded case reaches each of `FULFILLED` and `BROKEN` in a batch run, and a `BROKEN` case is confirmed to have its discount eligibility revoked and to no longer receive automated soft reminders on subsequent processing.

---

## 13. Phase 8 — Compliance Gate (the most important phase — do not compress this)

### 13.1 Shared test harness — build this before writing any individual rule

Create `lib/rules/rules.test.ts` with one shared pattern every rule's tests follow:

```typescript
type RuleTestCase = {
  name: string;
  action: ProposedAction;
  context: CustomerContext;
  expectAllowed: boolean;
  expectReasonContains?: string; // substring match on the reason, when blocked
};

function runRuleTestCases(rule: ComplianceRule, cases: RuleTestCase[]) {
  for (const c of cases) {
    const result = rule(c.action, c.context);
    if (result.allowed !== c.expectAllowed) {
      throw new Error(`FAILED: ${c.name} — expected allowed=${c.expectAllowed}, got ${result.allowed}`);
    }
    if (c.expectReasonContains && !result.reason.includes(c.expectReasonContains)) {
      throw new Error(`FAILED: ${c.name} — reason did not mention "${c.expectReasonContains}"`);
    }
  }
}
```

Every one of the 13 rule files below must export its own array of `RuleTestCase` and call `runRuleTestCases`, covering at minimum: one case that should pass, one that should be blocked, and one boundary case (e.g., exactly at a time threshold, exactly at a count threshold). Building this harness first means all 13 rules get tested the same consistent way instead of 13 improvised approaches.

### 13.2 The 13 rules, precisely specified

Every rule is a pure function: `(action: ProposedAction, context: CustomerContext) => RuleResult`, where `RuleResult = { allowed: boolean; reason: string; rescheduleTo?: Date }`.

**Rule 1 — Contact window** (`01-contact-window.ts`): use `isWithinContactWindow` from `lib/time/ist.ts`. Reject if false. No parameter on this function accepts an override — the only way to change the boundary is editing this file directly, never at runtime.

**Rule 2 — Frequency cap** (`02-frequency-cap.ts`): query the audit log for `context.customer_id` across every channel in the trailing 24h and trailing 7 days. Reject if it would exceed 2/day or 5/week.

**Rule 3 — Cooling-off** (`03-cooling-off.ts`): reject if the last logged contact to this customer, any channel, was less than 4 hours ago, even if under the daily cap.

**Rule 4 — Opt-out / DND** (`04-opt-out.ts`): check `context.is_opted_out` first, before any other rule runs in the gate's aggregate function (see 13.3). Hard reject, log it, and the gate should skip evaluating the remaining rules once this one fails — there's no reason to compute Rule 9's tone check on a message that's never going to be sent anyway.

**Rule 5 — Verified-contact-only** (`05-verified-contact.ts`): the channel/address on `action` must exactly match `context.customer_phone` or `context.customer_email` as generated in the seed data. Any mismatch is a hard reject.

**Rule 6 — Pre-debit notice** (`06-pre-debit-notice.ts`): for any retry-type action on a mandate, check the audit log for a notice sent ≥24h before the proposed retry time. If missing: **do not simply reject.** Auto-insert a `SEND_PRE_DEBIT_NOTICE` action, and set `rescheduleTo` using `nextValidComplianceSlot(now + 24h)` from `lib/time/ist.ts` — **not** a raw `now + 24h` timestamp. This is the fix for the rescheduling bug: adding exactly 24 hours to a timestamp preserves the time-of-day, so a failure at 11 PM naively reschedules to 11 PM the next day, which is still outside the contact window. Routing through `nextValidComplianceSlot` guarantees the result satisfies both Rule 1 and Rule 8 simultaneously.

**Rule 7 — One charge per mandate per day** (`07-one-charge-per-day.ts`): reject if `context.mandate_id` already has a logged charge attempt today (IST calendar day).

**Rule 8 — NPCI non-peak retry window** (`08-npci-window.ts`): for AutoPay retry actions specifically, use `isWithinNpciNonPeakWindow` from `lib/time/ist.ts`. Reject if false.

**Rule 9 — Tone and content check** (`09-tone-content.ts`): runs on the generated message text from Execution (Phase 12), not on the action itself — this rule needs to be called a second time, after message generation, before dispatch, not just once at the top of the gate. Maintain a banned-pattern list (case-insensitive substring/regex match): threat language ("legal action," "will be reported," "consequences"), shaming language ("everyone will know," "embarrassing"), excessive urgency (multiple exclamation marks, "immediately" combined with a threat word, all-caps runs). If flagged: block dispatch, route to a `human_review_queue` table, never auto-correct and send.

**Rule 10 — Discount fairness** (`10-discount-fairness.ts`): if the action is `OFFER_APPROVED_DISCOUNT`, define three bands in code (e.g., `standard: 0-5%`, `at_risk: 5-15%`, `high_value: 5-10%`) keyed to `context.customer_segment`. Reject if the offered discount is outside that customer's band. Log the `(segment, band, offer)` tuple to a dedicated fairness-audit table regardless of pass/fail, so the counterfactual and dashboard views can show discount distribution across segments later.

**Rule 11 — Stop-loss** (`11-stop-loss.ts`): reject (and the caller should substitute `STOP_AND_WRITE_OFF` or `ESCALATE_TO_HUMAN`) if `context.previous_attempts_total_21d >= 5` with no resolution.

**Rule 12 — Bounce suppression** (`12-bounce-suppression.ts`): reject if `context.last_contact_status === "FAILED_INVALID_NUMBER"`. Per the README, do not attempt a secondary contact method — mark the record for human review instead. This directly enforces the RBI ban on reaching third parties by ensuring the system never "gets creative" about finding an alternate way to reach someone.

**Rule 13 — Customer dispute freeze** (`13-dispute-freeze.ts`): reject if `context.is_disputed === true`. This should be checked early, similarly to Rule 4 — a disputed record shouldn't proceed through the rest of the gate's evaluation once this fires, since there's no scenario where a disputed record should be contacted automatically regardless of what any other rule says.

### 13.3 The gate aggregator

Build `lib/rules/gate.ts`:

```typescript
async function runComplianceGate(action: ProposedAction, context: CustomerContext): Promise<GateResult> {
  // Fast-path exits: check these two first and short-circuit, since nothing else matters if either fires
  const optOut = checkOptOut(action, context);
  if (!optOut.allowed) {
    await logToAuditTrail(action, context, [optOut]);
    return { allowed: false, blockedBy: [optOut] };
  }
  const disputeFreeze = checkDisputeFreeze(action, context);
  if (!disputeFreeze.allowed) {
    await logToAuditTrail(action, context, [disputeFreeze]);
    return { allowed: false, blockedBy: [disputeFreeze] };
  }

  // Remaining rules, evaluated together
  const results = await Promise.all([
    checkContactWindow(action, context),
    checkFrequencyCap(action, context),
    checkCoolingOff(action, context),
    checkVerifiedContact(action, context),
    checkPreDebitNotice(action, context),
    checkOneChargePerDay(action, context),
    checkNpciWindow(action, context),
    checkDiscountFairness(action, context),
    checkStopLoss(action, context),
    checkBounceSuppression(action, context),
  ]);
  // Note: checkToneContent (Rule 9) is called separately, after message generation, not here — see 13.2.

  const blocked = results.filter(r => !r.allowed);
  await logToAuditTrail(action, context, [optOut, disputeFreeze, ...results]); // log every rule's result, allowed or not
  return { allowed: blocked.length === 0, blockedBy: blocked };
}
```

Every single call to this gate is logged — allowed and blocked alike — because "how often did the gate actually do something" is a headline metric.

**Definition of done:** all 13 rules have passing tests via the shared harness; running the gate against the full seeded batch produces block/reschedule counts matching or exceeding every minimum in the Phase 3 edge-case table; a manual trace of one Rule 6+8 interaction case confirms the rescheduled timestamp is provably inside both valid windows (write this specific check as an integration test, not just a visual check).

---

## 14. Phase 9 — Execution layer

### 14.1 Simulated channels

WhatsApp/SMS/Email: generate message text via the Claude wrapper (Phase 6.2), store it, render it in a chat-bubble UI component. State clearly in the UI that this is simulated. Immediately after generation and before "sending," run the text through Rule 9 (tone/content check) — this is the second call site for that rule described in 13.2.

Prompt requirements for message generation: explicitly instruct no urgency language, no guilt language, no fake scarcity, no legal-action phrasing — write messages that would pass Rule 9 by construction, not by luck. Pass `preferred_language` from the record; if `hi-en`, generate in Hinglish.

### 14.2 Real Razorpay test-mode payment links

Where the action is `GENERATE_PAYMENT_LINK`, call Razorpay's test-mode Payment Links API for real and use the returned link in the simulated message. This is the one real external integration worth doing — small effort, and it's the difference between a fully mocked demo and one with a genuine payment object at its core.

### 14.3 Hinglish voice — pre-rendered primary, live fallback secondary

For 2–3 representative cases (pick one from each record type: a payment failure, an abandonment, a B2B case), pre-generate a Hinglish voice script via Claude and render it to an MP3 using a TTS provider available to you (ElevenLabs, OpenAI TTS, or similar), saved to `public/audio/demo_case_<id>.mp3`. The Case Detail view's play button checks for a pre-rendered file first; if none exists for that specific case, it falls back to the browser's `SpeechSynthesis` API with a Hindi-capable voice if available, or a plain English read of the transliterated script if not.

Do this specifically because voice availability varies across OS/browser combinations, and a video recording is a single take — build the reliable path as primary, not as an afterthought fallback.

**Definition of done:** every allowed action produces a rendered message; at least one `GENERATE_PAYMENT_LINK` case produces a real, working Razorpay test-mode link (click it and confirm it loads); at least one pre-rendered Hinglish audio file plays correctly in the Case Detail view without relying on live browser speech synthesis.

---

## 15. Phase 10 — Audit trail

Every event from every layer (circuit breaker, diagnosis, decision, each of the 13 rule evaluations, promise-tracker state transitions, execution outcome) writes one row to an `audit_log` table:

```
{ id, case_id, timestamp, layer, event_type, detail_json, reasoning_text }
```

Build the Case Detail page (`app/case/[id]/page.tsx`) to read this log for one case and render it as a plain-English timeline, in order — this should be understandable to someone who has never seen the code.

**Definition of done:** clicking into any case shows its complete story, in the correct order, with every layer represented, including at least one visible circuit-breaker pause event somewhere in the batch and at least one visible promise-tracker transition.

---

## 16. Phase 11 — Dashboard and metrics

Compute and render, from the real batch run (never hardcoded):

- Total revenue at risk
- Gross recovered (use the resolution simulation defined below)
- **Net recovered yield** = gross recovered − total discounts issued − a fixed per-action cost figure (define this as a small constant per channel in code, e.g., ₹2 per WhatsApp message, ₹0.50 per SMS, document the assumption in a code comment — the point is that it's a real, documented number, not that it's precisely accurate)
- Recovery rate %
- Root-cause classification accuracy, read from `docs/metrics/diagnosis_accuracy.json`
- Compliance rule fire counts — one bar per rule
- Circuit breaker trip count
- Promise-to-pay fulfillment rate
- False-positive cost estimate (customers where the diagnosis confidence was low and the true label, once compared, didn't match — estimate cost as the action cost wasted on that contact)

**Resolution simulation — specify this explicitly, don't leave it vague.** For each executed action, define a fixed success probability by `(action_type, root_cause)` pair, documented in a table in code comments, e.g.: `SCHEDULE_COMPLIANT_RETRY` on `INSUFFICIENT_BALANCE` → 65% resolves; `OFFER_APPROVED_DISCOUNT` on `PRICE_SENSITIVITY` → 70% resolves; `ESCALATE_TO_HUMAN` → not simulated as resolved/unresolved by this system at all, since a human takes over. Roll a seeded random number against this probability per record to mark it resolved or not. State plainly in the UI, next to the recovered-revenue number, that this is a modeled outcome on synthetic data, not a real payment result — this honesty is part of what makes the metrics credible rather than suspicious.

**Definition of done:** dashboard renders real computed numbers from the actual Supabase data for the actual batch run; every number on the dashboard has a traceable source (a query or a computation you can point to), none are hardcoded; the resolution-probability table is visible in code comments.

---

## 17. Phase 12 — Counterfactual comparison view

Run the Decision Layer's output through the Compliance Gate twice per record: once for real, once through a stub gate that always returns `allowed: true` (skip Rule 9's message-level check in the stub path too, for a true naive comparison). Store both outcomes. Build `app/counterfactual/page.tsx` as a two-column view — "naive agent" vs. "Firmline" — highlighting every case where they diverge, with the real gate's block reason shown alongside.

**Definition of done:** the view is live, shows at least as many divergent cases as the sum of the Phase 3 edge-case minimums, and each divergence links through to that case's full audit trail.

---

## 18. Phase 13 — Testing and metrics validation checklist

Before moving to polish, verify all of these are actually true — check each one, don't assume:

- [ ] Every one of the 13 rules has fired at least once in the real batch run (check dashboard rule-fire counts; any rule at zero means either the seed data or the rule itself has a bug — fix before proceeding)
- [ ] The Rule 6 + Rule 8 interaction (pre-debit notice reschedule) has fired at least once, and the rescheduled timestamp has been manually verified to fall inside both valid windows
- [ ] The circuit breaker has tripped exactly once on the seeded cluster, with a single audit event, not one per record
- [ ] The stop-loss rule has fired on at least one seeded case
- [ ] At least one promise-to-pay case reached `BROKEN` and is confirmed to have lost discount eligibility
- [ ] At least one `is_disputed: true` case is confirmed to have zero automated actions taken on it
- [ ] At least one `FAILED_INVALID_NUMBER` case is confirmed to have not attempted any secondary contact
- [ ] `docs/metrics/diagnosis_accuracy.json` has real, non-placeholder numbers
- [ ] No hardcoded numbers exist anywhere in the dashboard — search the codebase for suspicious literal numbers in dashboard components as a final check

---

## 19. Phase 14 — Polish pass

- Empty and loading states for every screen
- Mobile responsiveness — a judge may open the live link on a phone
- Keyboard focus visibility, reduced-motion support
- Visual direction: ground the UI in a passbook/ledger metaphor — deep ink navy background, warm off-white ledger-paper cards, monospace numerals for money/IDs/timestamps, a rotated ink-stamp graphic (muted green for cleared, muted rust-red for blocked) marking every compliance decision, one brass/gold accent reserved only for the net-recovered-yield number. Avoid generic AI-interface defaults: no cream-background-plus-serif-plus-terracotta, no near-black-plus-neon-accent, no broadsheet-hairline layout. One deliberate animation — the stamp visually landing when a decision renders during the live batch view — and quiet everywhere else.

**Definition of done:** every screen has been visited in a fresh incognito window on both a desktop and a narrow mobile viewport, with no visibly broken states.

---

## 20. Phase 15 — Deployment

1. Confirm all five environment variables are set in Vercel project settings (re-check, don't assume Phase 0's setting is still correct after any project changes).
2. Confirm the Supabase free-tier project is active, not paused.
3. Load the seed batch into the production Supabase instance.
4. Push to `main`, wait for Vercel to deploy.
5. Visit the live URL in a fresh incognito window and manually click through the entire path: land on the batch view → watch it run → click into a case → view the counterfactual → view the dashboard. Confirm each step works with zero prior context, as a judge would experience it.

**Definition of done:** the live URL, visited cold, works end to end with no errors and no login required.

---

## 21. Phase 16 — README finalization

Replace every `TBD` in the README's metrics table with real numbers from the actual deployed batch run. Add the live demo link. Add 2–3 real screenshots. Update the "What's not built yet" section to match what's actually true at this point — remove anything that's since been built, and don't leave stale claims in either direction.

Note the seed version used to produce the published metrics (`seed-v1` or whichever version is current) so the numbers are traceable — if the seed is ever regenerated, the README's numbers must be re-verified against the new run before publishing again, not left stale.

---

## 22. Phase 17 — Architecture document

Create `docs/architecture.md`. This is a required judged deliverable per Razorpay's own stated process ("show your work: a public repo, a 5 minute pitch video, the architecture"). It should restate the README's architecture section in more technical depth: the actual data flow, the actual schema, the actual rule specifications from Phase 8.2, and a short note on what was deliberately left out of scope and why (this reads as engineering maturity, not as a weakness).

---

## 23. Phase 18 — Demo video script (5 minutes)

| Time | Content |
|---|---|
| 0:00–0:30 | The problem, one sentence, one concrete real number (e.g., the RBI 8AM–7PM rule, or the ~20M/month UPI AutoPay revocation figure) |
| 0:30–1:15 | What Firmline is, in plain language |
| 1:15–2:30 | Live batch run — diagnosis, decision, gate, stamp, in real time |
| 2:30–3:15 | One case's full audit trail, read top to bottom |
| 3:15–4:00 | Counterfactual view, naive vs. Firmline, on the same batch |
| 4:00–4:40 | Dashboard — real numbers, net yield, compliance fire counts shown as a positive metric |
| 4:40–5:00 | What's built vs. what's next, live link on screen |

---

## 24. Phase 19 — Final submission checklist

- [ ] Batch run works end to end on real (synthetic) data with real computed metrics
- [ ] README complete, real numbers filled in, architecture documented
- [ ] `docs/architecture.md` exists and matches the README
- [ ] Live demo link works in a fresh incognito window
- [ ] 5-minute video recorded and linked from the README
- [ ] Submitted via the actual application form on the buildathon page

---

## Appendix: quick-reference for a resuming session

If you are picking this build back up mid-way: `docs/PROGRESS.md` is the source of truth for what's done. This manual is the source of truth for how to do what isn't done yet. When in doubt about a design decision already made earlier in the build, check `docs/architecture.md` if it exists, or this manual, before inventing a new approach — consistency across sessions matters more than any single session's stylistic preference.
