# Firmline blockers

## Phase 0 — Environment setup (OPEN)

As of 2026-08-23, this working directory had no git repo, no GitHub CLI auth, no Vercel CLI, and no API keys in the environment. Per BUILD_MANUAL.md Phase 0: "Requires a human... do not fabricate placeholder keys and continue."

Blocked on the human providing:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a Supabase free-tier project)
- `ANTHROPIC_API_KEY`
- `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET` (Razorpay test mode)
- Confirmation of a GitHub repo (public) and its connection to Vercel for auto-deploy on push

**Interim plan:** proceeding with all phases that require no live credentials (repo scaffold, schema, synthetic data generator, circuit breaker, rule-based classifiers, decision table, compliance gate — all 13 rules with unit tests, promise-tracker state machine, audit trail schema, dashboard against locally-seeded data if a local/dev Supabase connection is unavailable). Will pick up Claude-fallback wiring, Razorpay payment links, Supabase persistence, and deployment once credentials land.
