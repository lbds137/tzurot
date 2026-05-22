# Why `guard:proposal-links` exists

## What it does

Walks `docs/proposals/backlog/**/*.md` and asserts every proposal has at least one inbound link from `backlog/**/*.md`, `docs/**/*.md` (excluding `docs/proposals/`), `CURRENT.md`, or `BACKLOG.md`. Hard-fails CI on any proposal that's not mentioned anywhere outside its own directory. Also hard-fails on single-segment proposal slugs (basenames without `-` or `_`), which would defeat the orphan-check's word-boundary regex.

## Why it was built

The discovery pass on 2026-05-22 that motivated this tool found **7 of 14 existing proposals had zero inbound links** — half the queue. One (`tts-phase-3-voice-consolidation-plan.md`) was already-shipped work that should have been deleted months ago per the lifecycle rule in `07-documentation.md`. Another was a stale plan that diverged from the actual implementation. The pattern is the same as the audit-tool-rot pattern Layer 2 protects against: a doc exists, no one references it, no one ever reads it again, it gradually becomes wrong without anyone noticing.

The orphan-check is the structural enforcement that proposal-doc rot can't happen silently. A new proposal MUST be linked from somewhere actionable in the same PR — backlog file, README, current work log. That forces the "this is real future work" vs. "this is just a brainstorm" decision at proposal time, not 6 months later when no one remembers.

It runs in regular CI (the `lint` job), not on a cron — exactly the same regular-CI shape as the canary-pilot tools. The failure mode it guards against (proposal exists, nothing references it) is the same shape as tool rot (tool exists, nothing exercises it).

## Threshold rationale

Zero orphans, zero single-segment slugs. No grandfathered allowlist yet — the discovery pass triaged all 7 historic orphans inline, so current state is clean and the gate is satisfied. The allowlist becomes necessary if a future PR introduces a proposal whose linking is deliberately deferred (e.g., a brainstorm the author wants to keep but not promote); at that point, add the allowlist + aging-out logic per the proposal doc's Layer 1 PR-status note.

The single-segment slug constraint is a precision requirement, not a style preference: the orphan check's word-boundary regex can't distinguish a genuine markdown link to `memory.md` from any prose mention of the word "memory." Multi-segment names (`memory-and-context-redesign.md`, `MEMORY_INGESTION_IMPROVEMENTS.md`) make accidental matches vanishingly unlikely. Both `-` and `_` count as segment separators because the underlying regex character class `[a-zA-Z0-9_-]` treats both as word characters.

## Decay check

When this tool's reminder fires:

- Did the project move proposals to a different location? Update `PROPOSALS_GLOB` and `SEARCH_ROOTS`.
- Is the proposal-doc system unused (nothing in `docs/proposals/backlog/` for months)? Consider deleting the tool — there's nothing to guard.
- Did the team adopt a different planning system (e.g., GitHub Issues + Projects exclusively)? Delete the tool — proposals aren't the tracking unit anymore.
- Is the orphan-check producing false positives? Investigate the `EXCLUDED_PREFIXES` and `SEARCH_ROOTS` lists — they may need expansion.

The real-repo self-validation test at the bottom of `check-proposal-orphans.test.ts` ensures any drift toward orphans is caught locally before CI. Don't remove that test.
