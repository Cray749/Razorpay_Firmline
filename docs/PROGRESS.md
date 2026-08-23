# Firmline build progress

Last updated: 2026-08-23 (IST)

## Phase log
| Phase | Status | Notes |
|---|---|---|
| 0 | IN_PROGRESS | Repo/deps scaffolded, git initialized, local commits happening. Blocked on human providing real credentials (Supabase, Anthropic, Razorpay) and GitHub/Vercel connection — user will create .env.local and set up GitHub/Vercel themselves; proceeding with all credential-independent phases meanwhile. See docs/BLOCKERS.md |
| 1 | DONE | Next.js 16.3.2 (App Router) + TS + Tailwind scaffolded directly into repo root (not a nested `firmline/` dir — repo root IS the app root). Deliberate deviation from manual's literal "Next.js 14" pin: create-next-app@latest gave 16.3.2; using a 2-years-stale major in 2026 would be worse. Full folder structure created with stubs. `npm run dev` verified (HTTP 200). |
| 2 | DONE | data/seed/schema.ts written verbatim per manual, SEED_SCHEMA_VERSION=1, compiles clean. |
| 3 | NOT_STARTED | Data generator — next up |
| 4 | NOT_STARTED | |
| 5 | NOT_STARTED | |
| 6 (6.1 IST util) | DONE | lib/time/ist.ts built, empirically verified correct under both IST-local and TZ=UTC-forced Node processes (Vercel simulation). All required boundary/rollover unit tests pass (`npm test`). Caught and fixed a real month/year-rollover bug during testing. |
| 6 (6.2 Claude wrapper) | DONE | lib/claude/client.ts built: never throws, returns typed success/failure, logs every call (latency+outcome) to the audit trail. Verified via test with invalid API key — returns success:false, audit row written, no crash. |
| 6 (decision table) | NOT_STARTED | |
| 7 | NOT_STARTED | |
| 8 | NOT_STARTED | |
| 9 | NOT_STARTED | |
| 10 | NOT_STARTED | |
| 11 | NOT_STARTED | |
| 12 | NOT_STARTED | |
| 13 | NOT_STARTED | |
| 14 | NOT_STARTED | |
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
