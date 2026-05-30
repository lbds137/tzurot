## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

1. **Cut v3.0.0-beta.126 release** — develop is at beta.126, closing the **Route Manifest Scaffold + Typed-Client Codegen** epic (see `active-epic.md`, ✅ COMPLETE) plus the vision-timeout fix (PR #1117) and the gateway timeout-regression fix + structural guard (PR #1119). Dev smoke confirmed the core transport surface (chat, voice in/out, multi-tag, DMs, db-sync, persona/character/voice-models). Remaining steps: release PR (develop→main), tag, GitHub release, `release:finalize`, reset CURRENT.md. No migrations in this release. Once merged this slot empties and the next theme gets promoted into `active-epic.md` (`next-theme.md` is currently open — user picks).

_The typed-client / adminFetch architectural refactor (PR #1087, the epic's foundation) is **complete**. Two trigger-gated follow-ups it surfaced were resolved: the forensic audit trail for non-owner diagnostic 404s moved to `deferred.md`; the redundant per-route `requireServiceAuth` now lives only in runtime-dead legacy code that PR-2m (`inbox.md`) will delete._

### Most likely next-session pickups

1. **Self-Hosted TTS + BYOK Re-Eval — BYOK bake-off** ([future-themes.md](future-themes.md)): pricing-and-quality probe of Cartesia / Fish Audio / PlayHT / Resemble against current Mistral. The CPU self-hosted side closed 2026-05-13 — Pocket TTS uniquely wins and covers the 1-4 min use case. Step 0: research-pass compile of current BYOK pricing landscape; then hands-on API probes against existing emily/lila/lilith references using the reusable May-13 pattern.
2. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action only — no code work, but worth doing post-deploy to verify the audit tool's prod-side correctness.

### Other in-flight

_None._
