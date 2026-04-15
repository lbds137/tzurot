# Current

> **Session**: 2026-04-14
> **Version**: v3.0.0-beta.97

---

## Session Goal

_Ship the NOW bundle from last night's vision-pipeline investigation → ship the PRs that surfaced along the way → cut a release._ Ended up shipping **four PRs + a release** in one sitting, driven by two prod incidents surfaced mid-session (persona identity confusion + TTS voice failure).\_

## Active Task

🏗 **Identity & Provisioning Hardening Epic — Phase 1 shipped, Phase 2 queued.**

Phase 1 (this session, PR #803): tactical heal for persona-snowflake bug. 14 affected users healed in prod. Code-side regression closed via `getOrCreateUserShell`.

**Next session entry point**: `docs/reference/architecture/epic-identity-hardening.md` — the epic's living document. Start by council-reviewing the Phase 2 design (unify provisioning choke point) before writing any code.

Session-end infrastructure (all done):

- [x] Epic living doc — `docs/reference/architecture/epic-identity-hardening.md`
- [x] ADR template — `docs/reference/templates/adr-template.md`
- [x] Auto-memory refreshed — 7-week recovery window + Identity epic project memory
- [x] Plan-file housekeeping — `majestic-drifting-lightning.md` deleted (merged)
- [x] `/tzurot-git-workflow` skill updated with missing GitHub-Release step (procedural gap from this session's release)

---

## Completed This Session

### PR #802 — Vision-pipeline diagnostic bundle

- Reclassify `AbortError` as `TIMEOUT` (was silently UNKNOWN → retry storms)
- New `MEDIA_NOT_FOUND` category for dead-URL 404s (permanent, skips re-retry via cache)
- Vision `maxAttempts` 3 → 2 (worst-case 270s → 180s wait on hopeless images)
- `withRetry` telemetry enrichment: `attempt`, `durationMs`, `operationName`, `errorCategory`
- Railway `--filter` passthrough for server-side log query DSL
- 4 backlog items filed (2 Icebox revisit items + Observability & Analytics themes)

### PR #803 — Persona provisioning heal + Identity epic Phase 1

- Root cause: `getOrCreateInternalUser(discordId, discordId)` baked snowflake as Persona.name
- Regression traced to `c88ae5b7` (2025-12-20 refactor) — went undetected for ~4 months (14 users affected, 6% hit rate)
- New `UserService.getOrCreateUserShell` method for HTTP-route user creation without immediate persona provisioning
- `MemoryRetriever.getAllParticipantPersonas` no longer silently drops participants with empty persona content
- One-off migration healed 14 affected users in prod (incl. the user who triggered the investigation)

### PR #804 — Quickwin bundle

- Drop `userCache.set` from shell path (eliminates singleton hazard)
- DRY'd P2002 race recovery into `fetchExistingUserAfterRace` helper
- Remove unused `_config` from `createPreset` + cascaded dead-code cleanup
- Stale BACKLOG entry pruning

### PR #805 — TTS budget unification

- Root cause: two separate TTS budgets (150s ElevenLabs, 240s voice-engine), wrong one applied when ElevenLabs-configured user's request fell back to voice-engine
- Unified to single `TTS_MAX_TOTAL_MS = 240_000` across both paths
- ElevenLabs `maxAttempts` 2 → 1 (same pattern as vision AbortError fix)
- pytest-asyncio 0.x → 1.x for pytest 9 compatibility (unblocked voice-engine CI)
- 3 deferred options filed as backlog (proactive warmup, per-attempt timeout tuning, STT/voice-engine retry audit)

### Out-of-band changes on develop

- Pytest bump to 9.0.3+ for GHSA tmpdir CVE (Dependabot alert #84 closed)
- Post-merge cleanup polish from PR #805 review feedback (comment placement, test annotations)

### Investigation & forensics

- Prod log analysis: 99/1000 vision failures, 63% AbortError, 30% rate_limit, 7% URL-404
- Prod DB query: confirmed 14 users with snowflake persona names, traced to specific refactor date
- Prod log analysis: TTS failure timeline (ElevenLabs 2×60s + voice-engine 47s cold start = 167s > 150s budget)
- Council consulted three times (vision retry policy, TTS budget design, general architectural assessment)
- Architectural smell audit of identity/persona subsystem (findings inform upcoming Phase 2)

### Release

- **v3.0.0-beta.97** shipped via PR #806 — 4 bug fixes + 3 improvements + 5 chores
- Railway deploying from main at this point
- Post-deploy validation queued: query ai-worker logs for new telemetry fields + verify TTS pipeline max-1-attempt behavior

---

## Scratchpad

**Post-deploy validation commands** (Railway logs DSL now available):

```bash
pnpm ops logs --service ai-worker --env prod --filter "vision" --lines 2000
pnpm ops logs --service ai-worker --env prod --filter "TTS" --lines 1000
pnpm ops logs --service ai-worker --env prod --filter "@level:info attempt" --lines 500
```

**Baselines to beat post-deploy**:

- Vision: 99 failures / 1000 log lines, 63% AbortError classified as UNKNOWN (should be 0% now)
- TTS: any failure where ElevenLabs was attempted twice AND voice-engine failed to warm up (should be zero 2-attempt cases now)

**Identity epic Phase 2 scope reminder** (from the pre-Phase-1 audit):

1. Unify user provisioning — all creation through a single UserService method, no direct `prisma.user.create` outside service
2. Eliminate `PersonaResolver.setUserDefault` lazy mutation side effect
3. Kill `discord:XXXX` dual-tier personaId format
4. DB-level FK constraint `User.defaultPersonaId → Persona.id`
5. Integration test coverage for the refactor-regression class (would have caught `c88ae5b7`)

---

## Unreleased on Develop (since beta.97)

_(Empty — release just shipped.)_

---

## Previous Sessions

- **2026-04-14**: **Identity epic Phase 1** + vision retry fix + TTS budget fix + release (PRs #802-#806), beta.97
- **2026-04-13**: Backlog shrinkage (PRs #794-800), deps update, preset UX, beta.96
- **2026-04-12**: Voice engine hardening (PR #785), Python hooks, release audit, beta.95
- **2026-04-11**: CPD Session 1 (PRs #778-780), channel rename (#781), doc audit (#782-784)
- **2026-04-10**: Browse Step 8 (PR #776), CPD 137→126
- **2026-04-09**: Browse Steps 6-7 (PR #775), footer design plan + council consultation

## Recent Releases

- **v3.0.0-beta.97** (2026-04-14) — Identity & provisioning heal (14 users), vision retry classifier fix + telemetry, TTS budget unification, pytest security bump
- **v3.0.0-beta.96** (2026-04-13) — Mention parser fixes, forwarded messages, preset error surfacing, deps update, refactors
- **v3.0.0-beta.95** (2026-04-12) — Voice engine lazy loading, ElevenLabs abort fix, CPD Session 1, browse epic, doc audit
- **v3.0.0-beta.94** (2026-04-10) — Browse standardization, config override helpers, shared abstractions

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
