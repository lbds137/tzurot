# Current

> **Session**: 2026-04-17 (ended, rolled over from 2026-04-16)
> **Version**: v3.0.0-beta.99 (released 2026-04-17 — Identity Epic Phases 3–5b + UX polish + db-sync fix)

---

## Next Session Goal

_Phase 5c (eliminate shell-creation path) → then Phase 6 integration tests. Release cadence is open; no specific deadline._

1. **Phase 5c council pressure-test** (~45 min): settle the API-contract question — where does "user must be provisioned" live? Options: bot-client pre-provisions via `getOrCreateUser` before any slash-command → HTTP call, OR api-gateway middleware that calls `getOrCreateUser` given the bot-client passes username/displayName/bio headers, OR auth-extension approach. Council should pressure-test all three.
2. **Phase 5c implementation**: delete `getOrCreateUserShell`, `createShellUserWithRaceProtection`, `buildShellPlaceholderPersonaName`, the placeholder-rename block in `runMaintenanceTasks`. Swap ~13 api-gateway HTTP routes from shell-path to `findUserByDiscordIdOrFail` (404 if not provisioned). Audit ~20 slash-command handlers for pre-provision. **Folded-in cleanups**: tighten `User.defaultPersona` relation from `Persona?` → `Persona`; break the test-utils ↔ common-types Turbo build-DAG cycle and switch `seed.ts` to import `DEFAULT_PERSONA_DESCRIPTION` directly. Expected ~200–400 LOC net delete once the cutover lands.
3. **Phase 6**: integration test coverage for the refactor-regression class (`c88ae5b7`). End-to-end "HTTP route → Discord interaction → prompt correctness" test. ~2 days.

## Active Task

🏗 **Identity & Provisioning Hardening Epic — Phases 1–5b shipped to prod. Phase 5c next, then Phase 6.**

Epic status (all in prod as of beta.99):

- ✅ Phase 1 (PR #803, beta.97): tactical heal for persona-snowflake bug. 14 users healed in prod.
- ✅ Phase 2 (PRs #807, #808, beta.98): single choke point for user creation, `ProvisionedUser` return type, ESLint guard on direct `prisma.user/persona.create`.
- ✅ Phase 3 (PR #814, beta.99): eliminated `PersonaResolver.setUserDefault` lazy mutation — read-only resolver, persistence moved to UserService.
- ✅ Phase 4 (PR #816, beta.99): killed `discord:XXXX` dual-tier personaId format.
- ✅ Phase 5 (PR #817, beta.99): DB-level invariants — Restrict FK on `user.default_persona_id`, unique `(owner_id, name)` on personas, CHECK constraints `personas_name_non_empty` and `personas_name_not_snowflake`.
- ✅ Phase 5b (PR #818, beta.99): NOT NULL on `users.default_persona_id` via single-statement CTE bootstrap. Deleted `backfillDefaultPersona` (90 LOC). Added `seedUserWithPersona` helper to test-utils.
- 📋 **Phase 5c (next)**: eliminate shell-creation path entirely. Council pressure-test first.
- 📋 Phase 6: integration test coverage for refactor-regression class.

---

## Completed This Session (2026-04-16 → 2026-04-17)

Very long session. Started as Phase 5b implementation; ended with beta.99 shipped to prod.

### Phase 5b shipped (PR #818, six review rounds)

- **Core fix**: `users.default_persona_id` is now NOT NULL at DB, Prisma, and TypeScript layers.
- **CTE bootstrap**: circular-FK between users and personas solved via single-statement `$executeRaw` CTE. Council pressure-tested: recommended over deferred CHECK (keeps nullable types) or DEFERRABLE FK (introduces Prisma drift toil).
- **Dead-code removal**: `backfillDefaultPersona` (90 LOC + 4 unit tests) deleted. `UserWithBackfillFields` renamed to `UserWithMaintenanceFields`.
- **test-utils**: new `seedUserWithPersona` helper + colocated `seed.int.test.ts`. Replaced raw SQL duplication across 9 int test files.
- **Six review rounds**: R1 displayName propagation, R2 P2002 target filter symmetry, R3 stale comment + PR refs removal + seed test, R4 interface rename + logs, R5 shell-path P2002 coverage, R6 "atomically" comment word fix (direct-to-develop cherry-pick).

### Beta.99 release shipped (PR #819, eleven review rounds)

- **Bundle contents**: Phases 3/4/5/5b (Identity Epic), UX polish (age verify on direct-bot-ping, avatar timeout, backtick mentions, taking-longer decoupling — PR #815), db-sync deferred-FK fix (PR #813), hono/langsmith CVE bumps.
- **Pre-flight**: re-verified 0 null default_persona_id + 0 duplicate (owner_id, name) + 0 empty/snowflake-pattern names against CURRENT dev + prod (not stale pre-flight from days ago).
- **Release PR "conflicts" diagnosed**: develop had pre-rebase SHAs of beta.98-era commits, main had the rebased versions. Git auto-skipped via `--reapply-cherry-picks` detection. Rebased develop, force-pushed, conflicts gone.
- **Eleven review rounds landed**: most were re-confirmations of already-tracked items; actionable fixes: PersonaResolver FK-comment stale `SetNull` → `Restrict`, `INTERNAL_DISCORD_ID_PREFIX` extracted to `services/bot-client/src/constants/personaId.ts` to break service → contextBuilder import, `ownedPersonaCount` misleading log field removed, `isPrismaUniqueConstraintError` tightened from substring to element-equality match, `DEFAULT_PERSONA_DESCRIPTION` extracted to common-types constants layer (partial — Turbo DAG blocks the test-utils side).
- **Deployment**: prod deploy at 05:52 UTC, all three services clean, Phase 5 + 5b migrations applied post-deploy, zero error-level logs.
- **Release artifacts**: tag `v3.0.0-beta.99` pushed, GitHub release published (prerelease per convention), develop rebased onto main (step 5 that got missed after beta.98 — not missing it this time).

### Process / design decisions surfaced this session

- **"Phase 5 isn't done until 5b is done"** — user framing promoted 5b from deferred-backlog to in-session active. Correct call; NOT NULL is the load-bearing invariant.
- **"I don't see the point of divergent paths for this"** — user identified the shell path as a symptom of a missing abstraction, not a legitimate architectural split. Phase 5c scope redefined mid-session: eliminate the path entirely, not just paper over it.
- **"I worry we'll run into other stuff like this"** — schema-audit mini-epic added for post-Phase-6 work (find nullable-that-isn't FK columns, default-that-never-applies patterns, etc.). v3 dev started 2025-10; three load-bearing workaround patterns found in 6 months suggests more hide.
- **"was it necessary to make a new branch?"** — working-style calibration: doc-only / comment-only / BACKLOG-only changes default to direct-on-develop, not PR. Cherry-picked R6 fix onto develop.
- **Release flow step 5 gap**: discovered why beta.99's release PR showed phantom conflicts — the "rebase develop onto main after merge" step was skipped after beta.98. Added backlog entry for `pnpm ops release:finalize` automation. Did the rebase this time.

---

## Scratchpad

### beta.99 post-deploy validation (done)

- ✅ api-gateway: "API Gateway is fully operational!" @ 05:52:57 UTC
- ✅ ai-worker: "AI Worker is fully operational! 🚀" @ 05:52:58 UTC
- ✅ bot-client: Presence restored @ 05:53:03 UTC
- ✅ Phase 5 + 5b migrations applied to prod
- ✅ Zero error-level logs post-migration across all services
- ⏭️ User smoke-test skipped (no test user available)

### Phase 5c open questions for council pressure-test

1. **Where does "user must be provisioned" live?** Middleware (per-route invariant) vs. per-handler call vs. auth-extension (session enrichment)? Each has different failure modes when the invariant is violated.
2. **Does bot-client always have username/displayName at slash-command dispatch?** Discord interaction payload includes them, but need to verify for button/select-menu interactions where the original command's user context may have to be re-fetched.
3. **What's the contract when api-gateway receives a request for a non-provisioned user?** 404? 412 Precondition Failed? Auto-provision with a synthetic placeholder (defeats the purpose)?
4. **Cutover sequencing**: ship bot-client pre-provisioning first, wait a day to ensure all flows provision, THEN flip api-gateway routes to `findUserByDiscordIdOrFail`. Sequencing matters.
5. **Folded-in cleanups**: after the main cutover, tighten `User.defaultPersona` relation (`Persona?` → `Persona`), which then unlocks PersonaResolver dead-code deletion (Priority 3 fallback + dangling-FK branches become unreachable by type). Separate commit.

### Release-flow lessons learned

- **Step 5 (rebase develop onto main) was missed after beta.98**, surfaced on this release as phantom conflicts in PR #819. Fix: either automate it (`pnpm ops release:finalize` — tracked in BACKLOG) or add a session-start guard.
- **`pnpm ops run --env prod --` passthrough** requires the command directly, no `--` separator. `pnpm ops run --env prod --force tsx scripts/...` works; `pnpm ops run --env prod -- tsx ...` fails with "No command specified".
- **One-off preflight scripts** should live in `scripts/analysis/` and be deleted after use per the `scripts/` rule. Did that for the migration pre-flight check.

---

## Unreleased on Develop (since beta.100)

_One polish commit on top of main (`ad1d9348d` — PR #828 review items that didn't make the merge: deleted the one-off repair script, dropped stale PR-ref from `LlmConfigSummarySchema` JSDoc, removed unreachable branch in `classifyAndQueueRow`)._

---

## Previous Sessions

- **2026-04-17 (this session)**: **Phase 5b shipped + beta.99 release** — PR #818 (Phase 5b NOT NULL + CTE bootstrap), PR #819 (beta.99 bundling phases 3/4/5/5b/#813/#815 + CVE bumps). Prod migrated, tag + GitHub release published, develop rebased onto main.
- **2026-04-15 / 2026-04-16**: **Identity epic phases 3/4/5 + beta.98 release bundle** — PRs #807, #808 (Phase 2), #809 (cross-channel security), #810 (MEDIA_NOT_FOUND regex), #811 (abbreviation periods), #812 (release), then unreleased phases 3/4/5 (PRs #814/#816/#817).
- **2026-04-14**: **Identity epic Phase 1** + vision retry fix + TTS budget fix + release (PRs #802-#806), beta.97.
- **2026-04-13**: Backlog shrinkage (PRs #794-800), deps update, preset UX, beta.96.
- **2026-04-12**: Voice engine hardening (PR #785), Python hooks, release audit, beta.95.
- **2026-04-11**: CPD Session 1 (PRs #778-780), channel rename (#781), doc audit (#782-784).
- **2026-04-10**: Browse Step 8 (PR #776), CPD 137→126.

## Recent Releases

- **v3.0.0-beta.100** (2026-04-18) — Two prod blockers fixed (`/admin db-sync` Ouroboros Insert refactor + `/settings preset default` RFC-4122 UUID repair), character field silent-truncation warning flow (PR #825, two-click opt-in), PersonaResolver focus-mode query collapse, typed `NAME_COLLISION` sub-code, preset clone auto-numbering, protobufjs CVE. Migration: circular FKs made DEFERRABLE. New PGLite int test for db-sync class-of-bug. New 00-critical.md rule: "Don't Present Speculation as Fact".
- **v3.0.0-beta.99** (2026-04-17) — Identity Epic Phases 3-5b (read-only PersonaResolver + discord:XXXX format kill + DB-level invariants + NOT NULL default_persona_id), UX polish bundle (age verify on direct-bot-ping, avatar timeout, backtick mentions, taking-longer decoupling), db-sync deferred-FK fix, hono/langsmith CVE bumps. Two migrations (Phase 5 + 5b).
- **v3.0.0-beta.98** (2026-04-15) — Cross-channel permission guard (security), MEDIA_NOT_FOUND regex fix, abbreviation-period mention matching, Phase 2 Identity Hardening (provisioning choke point + `ProvisionedUser` type + ESLint guard).
- **v3.0.0-beta.97** (2026-04-14) — Identity & provisioning heal (14 users), vision retry classifier fix + telemetry, TTS budget unification, pytest security bump.
- **v3.0.0-beta.96** (2026-04-13) — Mention parser fixes, forwarded messages, preset error surfacing, deps update, refactors.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [epic-identity-hardening.md](docs/reference/architecture/epic-identity-hardening.md) - Phase 5c / 6 entry points
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
