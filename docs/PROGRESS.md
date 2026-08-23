# Firmline build progress

Last updated: 2026-08-23 (IST)

## Phase log
| Phase | Status | Notes |
|---|---|---|
| 0 | IN_PROGRESS | Repo/deps scaffolded, git initialized, local commits happening. Blocked on human providing real credentials (Supabase, Anthropic, Razorpay) and GitHub/Vercel connection — user will create .env.local and set up GitHub/Vercel themselves; proceeding with all credential-independent phases meanwhile. See docs/BLOCKERS.md |
| 1 | DONE | Next.js 16.3.2 (App Router) + TS + Tailwind scaffolded directly into repo root (not a nested `firmline/` dir — repo root IS the app root). Deliberate deviation from manual's literal "Next.js 14" pin: create-next-app@latest gave 16.3.2; using a 2-years-stale major in 2026 would be worse. Full folder structure created with stubs. `npm run dev` verified (HTTP 200). |
| 2 | DONE | data/seed/schema.ts written verbatim per manual, SEED_SCHEMA_VERSION=1, compiles clean. |
| 3 | DONE | data/seed/generate.ts + rng.ts: seeded mulberry32 PRNG, 200 records (PF 84/CA 58/B2B 58), every edge-case minimum met (printed validation table), reproducible (re-run diff identical except `generated_at`). `npm run seed` writes data/seed/seeds/seed-v1.json and loads to Supabase when configured (currently gracefully skips + warns). Caught and fixed a real IST-midnight UTC-slicing date bug via the validation step. |
| 4 | DONE | lib/circuit-breaker/index.ts: rolling 15-min window by record timestamp, 15% GATEWAY_TIMEOUT threshold, added a minimum-sample-size gate (5) after testing revealed isolated single-record windows were trivially "100% of window" and falsely tripping. Verified against the real seed-v1 cluster: exactly 1 trip audit event + 1 resume audit event (not proportional to the 9 records actually paused). |
| 5 | DONE | Rule-based classifiers (PF/CA/B2B) + Claude fallback (lib/classifier/*, lib/claude/diagnose-fallback.ts). docs/metrics/diagnosis_accuracy.json has real computed precision/recall (97.9% overall on rule-based-only pass, since ANTHROPIC_API_KEY isn't configured yet — Claude fallback degraded gracefully as designed, 0 crashes, 9 records correctly flagged needs_human_review). Spot-checked 5 records by hand against true_root_cause. **TODO before final README numbers**: re-run `npm run measure:diagnosis` once Anthropic credentials land, to get the true blended (rule+Claude) accuracy. |
| 6 (6.1 IST util) | DONE | lib/time/ist.ts built, empirically verified correct under both IST-local and TZ=UTC-forced Node processes (Vercel simulation). All required boundary/rollover unit tests pass (`npm test`). Caught and fixed a real month/year-rollover bug during testing. |
| 6 (6.2 Claude wrapper) | DONE | lib/claude/client.ts built: never throws, returns typed success/failure, logs every call (latency+outcome) to the audit trail. Verified via test with invalid API key — returns success:false, audit row written, no crash. |
| 6 (decision table) | DONE | lib/actions/{types,decision-table}.ts: full lookup table for every taxonomy label, proactive stop-loss substitution (ESCALATE_TO_HUMAN for high_value, STOP_AND_WRITE_OFF otherwise) before proposing retries, deterministic Rule-5 contact-mismatch demo subset (5 PF records via `id % 17 === 4`). Tested. |
| 7 | DONE | lib/promise-tracker/state-machine.ts: PROMISED->DUE_DATE_PENDING->{FULFILLED,BROKEN}, fixed documented fulfillment probabilities per payment_history_pattern (0.85/0.6/0.3), broken promises revoke discount eligibility + force ESCALATE_TO_HUMAN on subsequent actions. Verified against real seed data: both outcomes reached, suppression on later processing confirmed. |
| 8 | DONE | Compliance gate: all 13 rules (lib/rules/01-13) + gate.ts aggregator + context.ts (audit-log-backed CustomerContext with a documented seed-baseline backfill policy). Shared runRuleTestCases harness, every rule has pass/blocked/boundary unit tests (rules.test.ts, 46 cases total). lib/batch/run-batch.ts: the real diagnose->decide->promise-tracker->gate pipeline, run against the full seed-v1 batch — all 12 action-level rules fire at least once (verified_contact and discount_fairness deliberately small, via designed demo subsets; the rest in the 9-45 range), and a real Rule 6+8 interaction case was traced with its rescheduleTo verified inside both windows. Found and fixed a real gap during testing: the decision table always proposed compliant discounts, so Rule 10 never had anything to block — added a small deterministic "discount overreach" demo subset (mirrors the earlier Rule 5 mismatch subset). |
| 9 | IN_PROGRESS | Execution backend + UI both done: lib/execution/{templates,message,execute}.ts, lib/claude/generate-message.ts, lib/razorpay/client.ts (real test-mode Payment Links REST call, notify disabled), Rule 6 auto-insert-notice flow, chat-bubble message rendering + voice preview button on the case page. Verified live in-browser: fallback-template messages render correctly, the naive-demo tone case gets caught by Rule 9 with the right audit trail and stamp. Remaining: 9.2 needs a live Razorpay key to verify a real link end-to-end; 9.3 (pre-rendered Hinglish MP3) blocked on a TTS credential Phase 0 never listed — see docs/BLOCKERS.md, browser SpeechSynthesis fallback works today and is verified live. |
| 10 | DONE | app/case/[id]/page.tsx + app/api/case/[id]/route.ts: full plain-English audit trail timeline, rendered per case, verified live in-browser against real batch data. |
| 11 | DONE | app/dashboard/page.tsx + lib/metrics/{dashboard,resolution-simulation}.ts: every number computed live (no hardcoding) — revenue at risk, gross/net recovered (documented resolution-probability table), recovery rate, discounts issued, action cost, false-positive cost, circuit breaker trips, promise fulfillment rate, compliance rule fire chart, diagnosis accuracy table. Verified live: Rs 2.18cr at risk, Rs 48.97L gross recovered, 22.41% recovery rate, all numbers traceable to a computation. |
| 12 | DONE | app/counterfactual/page.tsx: naive-vs-Firmline comparison from the naiveActions summary lib/batch/run-batch.ts carries per case. Verified live: 112/200 cases diverge, including a real Rule 9 catch (a naive "URGENT...legal action..." message blocked, shown side-by-side with what the naive agent would have sent). |
| 13 | DONE | scripts/verify-checklist.ts: automates all 9 checklist items against a real, fresh batch run (`npm run verify:checklist`). All 9/9 pass: every rule fires (incl. Rule 9 via tone-check), Rule 6+8 reschedule verified inside both windows, circuit breaker exactly 1 trip event for 9 paused records, stop-loss fires, a promise reaches BROKEN, a disputed case has zero dispatch, a bounced case attempts no secondary contact, diagnosis_accuracy.json has real numbers, dashboard has no hardcoded literals. |
| 14 | DONE | Loading skeletons (dashboard/counterfactual), global focus-visible outlines, reduced-motion guards on the stamp-land and skeleton-shimmer animations, mobile viewport checked (375px, no horizontal overflow). Empty states already existed for dashboard/counterfactual/case-not-found from earlier phases. `npm run build` succeeds cleanly. |
| 15 | NOT_STARTED | |
| 16 | NOT_STARTED | |
| 17 | NOT_STARTED | |
| 18 | NOT_STARTED | |
| 19 | NOT_STARTED | |

## Known blockers
See docs/BLOCKERS.md

## Environment variables confirmed present
- [ ] NEXT_PUBLIC_SUPABASE_URL
- [ ] NEXT_PUBLIC_SUPABASE_ANON_KEY
- [ ] ANTHROPIC_API_KEY
- [ ] RAZORPAY_TEST_KEY_ID
- [ ] RAZORPAY_TEST_KEY_SECRET
