# Firmline blockers

## Phase 0 — Environment setup (OPEN)

As of 2026-08-23, this working directory had no git repo, no GitHub CLI auth, no Vercel CLI, and no API keys in the environment. Per BUILD_MANUAL.md Phase 0: "Requires a human... do not fabricate placeholder keys and continue."

Blocked on the human providing:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a Supabase free-tier project)
- `ANTHROPIC_API_KEY`
- `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET` (Razorpay test mode)
- Confirmation of a GitHub repo (public) and its connection to Vercel for auto-deploy on push

**Interim plan:** proceeding with all phases that require no live credentials (repo scaffold, schema, synthetic data generator, circuit breaker, rule-based classifiers, decision table, compliance gate — all 13 rules with unit tests, promise-tracker state machine, audit trail schema, dashboard against locally-seeded data if a local/dev Supabase connection is unavailable). Will pick up Claude-fallback wiring, Razorpay payment links, Supabase persistence, and deployment once credentials land.

**Update (still Phase 0, mid-build):** the human chose to create `.env.local` themselves and set up GitHub/Vercel themselves (not yet confirmed done). Build proceeded through Phases 1-9 on all credential-independent work; all logic is written, unit-tested, and verified against the real seeded batch with Claude/Razorpay calls exercised in their documented graceful-degradation paths (never crash, always log, always fall back). Live verification (real Claude diagnosis accuracy, a real working Razorpay payment link, actual Supabase persistence, deployment) is still pending credentials.

## Phase 9.3 — Pre-rendered Hinglish voice (OPEN, new blocker)

Phase 9.3 wants 2-3 cases with a PRE-RENDERED MP3 (via "ElevenLabs, OpenAI TTS, or similar") as the primary playback path, with the browser's `SpeechSynthesis` API as a secondary fallback only. Phase 0's fixed credential list (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `ANTHROPIC_API_KEY`, `RAZORPAY_TEST_KEY_ID/SECRET`) does not include a TTS provider key, and per Phase 0's own instruction ("do not fabricate placeholder keys and continue"), one hasn't been assumed.

**Resolution:** the Case Detail page's voice playback is built with the browser `SpeechSynthesis` API as the working, functional path today (this was always meant to be a legitimate fallback per the README, not just an afterthought). If the human wants to supply a TTS API key (OpenAI TTS or ElevenLabs) later, pre-rendered MP3s for 2-3 representative cases can be generated and dropped into `public/audio/` — the play button already checks for a pre-rendered file first before falling back to live synthesis, so this degrades cleanly either way.
