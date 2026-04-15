# Current

> **Session**: 2026-04-15
> **Version**: v3.0.0-beta.97 (unreleased: Phase 2 on develop)

---

## Session Goal

_Resume after Anthropic auth downtime; council-review Phase 2 design of the Identity & Provisioning Hardening Epic, then ship the implementation._ Done: beta.97 prod-validated, Phase 2 shipped on `feat/identity-phase-2-provisioning-choke-point` branch.

## Active Task

🏗 **Identity & Provisioning Hardening Epic — Phase 1 + 2 shipped (PRs #803, #807, #808). Phase 3 queued for council review.**

Phase 2 this session: single choke point for user creation. All `prisma.user.create` / `prisma.persona.create` outside UserService + persona/crud.ts are banned at the AST level via ESLint `no-restricted-syntax`. `getOrCreateUser` now returns `ProvisionedUser` (non-null `defaultPersonaId`) so callers can't silently consume a shell user where a full one was expected. PR #808 applied two review-nit follow-ups on top (tighter int-test assertion + aliasing-bypass note in epic D5).

**Next session entry point**: council pressure-test of Phase 3 design (eliminate `PersonaResolver.setUserDefault` lazy mutation side effect — ~3 days estimated). Start at `docs/reference/architecture/epic-identity-hardening.md` § Phase 3. Cross-cutting principle: council review BEFORE each phase starts, not mid-implementation.

---

## Completed This Session (2026-04-15)

### PR #807 — Identity epic Phase 2 — provisioning choke point (merged)

- **Scope discovery**: Phase 1 audit missed 13 `resolveUserIdOrSendError` callers across 9 route files. All migrated to inline `userService.getOrCreateUserShell(discordUserId)`.
- **Deleted** `services/api-gateway/src/utils/routeHelpers.ts` + its test. The 400-for-bot branch was defensive-only — HTTP routes aren't bot-accessible.
- **`getOrCreateUser` return type**: `Promise<string | null>` → `Promise<ProvisionedUser | null>` where `ProvisionedUser = { userId; defaultPersonaId }`. Non-null `defaultPersonaId` is a structural assertion of full provisioning.
- **`runMaintenanceTasks` + `backfillDefaultPersona`** now return the effective persona id so cold-path lookups propagate the authoritative value even when backfill just-ran or short-circuited.
- **ESLint rule**: `no-restricted-syntax` bans `X.user.{create,upsert,createMany}` and `X.persona.{create,upsert,createMany}` outside `UserService.ts` and `persona/crud.ts`. Verified the AST selector doesn't false-positive on `mockPrisma.user.create.mockResolvedValue(...)`.
- **Three bot-client consumers** updated for new shape: `UserContextResolver`, `ReferenceEnrichmentService`, `MentionResolver`.
- **Council pressure-test** (Gemini 3.1 Pro) right-sized the scope: structural type > branded, ESLint > dep-cruiser, tests exempted entirely. Actual shipped in ~3 hrs vs. ~1-week estimate.
- Epic living doc updated with D4 (structural ProvisionedUser) and D5 (ESLint + test exemption) decisions.
- **Post-review follow-up** (commit `20333f4f0` on the same PR): split `backfillDefaultPersona` info/debug logs based on whether we did the backfill or short-circuited behind a concurrent winner. Extracted `PINO_LOGGER_RULES` constant in `eslint.config.js` (reviewer caught this as load-bearing — without extraction, the UserService override would have silently dropped Pino logger enforcement for that file). Historical-note comment in `nsfw.ts` explaining why dropping the old 200-advisory-for-bots is safe. Phase 3 breadcrumb in `UserContextResolver`. +5 tests covering concurrent-backfill branches. UserService.ts coverage: 94.21% → 100% lines, 82.53% → 98.41% branches.

### PR #808 — Phase 2 follow-up nits (merged)

- Tightened `UserService.int.test.ts` backfill assertion from `.not.toBeNull()` to deterministic UUID equality via `generatePersonaUuid(testUsername, userId)`. The test is now a contract for the UUID-generation function, not just the backfill flow.
- Documented ESLint aliasing-bypass limitation under epic D5 — `const { user } = prisma; user.create(...)` isn't caught by the AST selector. Escalation path (catch in review → dep-cruiser rule if pattern appears) explicitly specified in the decision record.

### Earlier session (2026-04-14)

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

**Identity epic remaining phases** (detailed in `docs/reference/architecture/epic-identity-hardening.md`):

- ~~Phase 2: Unify user provisioning~~ ✅ shipped in PRs #807, #808
- **Phase 3**: Eliminate `PersonaResolver.setUserDefault` lazy mutation side effect (council review first)
- Phase 4: Kill `discord:XXXX` dual-tier personaId format
- Phase 5: DB-level FK constraint `User.defaultPersonaId → Persona.id` + migration
- Phase 6: Integration test coverage for the refactor-regression class (would have caught `c88ae5b7`)

---

## Unreleased on Develop (since beta.97)

- **refactor(common-types)**: Phase 2 Identity Hardening — provisioning choke point (#807, #808). `ProvisionedUser` return shape for `UserService.getOrCreateUser`, ESLint `no-restricted-syntax` ban on direct `prisma.user.create` / `prisma.persona.create` outside UserService + persona/crud.ts, 13 HTTP-route callers migrated to `getOrCreateUserShell`, `routeHelpers.ts` deleted.

---

## Previous Sessions

- **2026-04-15**: **Identity epic Phase 2** — provisioning choke point + `ProvisionedUser` type + ESLint guard (PRs #807, #808)
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
