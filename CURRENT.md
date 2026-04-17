# Current

> **Session**: 2026-04-16 (ended)
> **Version**: v3.0.0-beta.98 (released 2026-04-15) — develop has Phases 3–5b unreleased

---

## Next Session Goal

_Phase 5c (eliminate shell-creation path) → then Phase 6 integration tests → then prod release for the accumulated unreleased phases. Release explicitly deferred — not tonight._

1. **Phase 5c council pressure-test** (~45 min): before implementation, settle the API-contract question — where does "user must be provisioned" live? Options: bot-client pre-provisions via `getOrCreateUser` before any slash-command → HTTP call (preferred), OR api-gateway middleware that calls `getOrCreateUser` given the bot-client passes username/displayName/bio headers, OR auth-extension approach. Council should pressure-test all three and identify which slash-command handlers would need refactoring.
2. **Phase 5c implementation**: delete `getOrCreateUserShell`, `createShellUserWithRaceProtection`, `buildShellPlaceholderPersonaName`, the placeholder-rename block in `runMaintenanceTasks`. Swap ~13 api-gateway HTTP routes from shell-path to `findUserByDiscordIdOrFail` (404 if not provisioned). Audit ~20 slash-command handlers for pre-provision. ~200–400 LOC net delete.
3. **Phase 6**: integration test coverage for the refactor-regression class (c88ae5b7). End-to-end "HTTP route → Discord interaction → prompt correctness" test. ~2 days.
4. **Release** after 5c or 6 lands — bundles Phases 3, 4, 5, 5b (and whichever of 5c/6 ships first) as beta.99. Not tonight.

## Active Task

🏗 **Identity & Provisioning Hardening Epic — Phases 1–5b shipped. Phase 5c next, then Phase 6.**

Epic status (all on develop, unreleased):

- ✅ Phase 1 (PR #803, beta.97): tactical heal for persona-snowflake bug. 14 users healed in prod.
- ✅ Phase 2 (PRs #807, #808, beta.98): single choke point for user creation, `ProvisionedUser` return type, ESLint guard on direct `prisma.user/persona.create`.
- ✅ Phase 3 (PR #814, unreleased): eliminated `PersonaResolver.setUserDefault` lazy mutation — read-only resolver, persistence moved to UserService.
- ✅ Phase 4 (PR #816, unreleased): killed `discord:XXXX` dual-tier personaId format.
- ✅ Phase 5 (PR #817, unreleased): DB-level invariants — Restrict FK on `user.default_persona_id`, unique `(owner_id, name)` on personas, CHECK constraints `personas_name_non_empty` and `personas_name_not_snowflake`.
- ✅ Phase 5b (PR #818, unreleased): NOT NULL on `users.default_persona_id` via single-statement CTE bootstrap. Deleted `backfillDefaultPersona` (90 LOC dead-code). Added `seedUserWithPersona` helper to test-utils. Six rounds of review feedback addressed (R1–R6) plus one direct-to-develop follow-up for R6 polish.
- 📋 **Phase 5c (next)**: eliminate shell-creation path entirely. Council pressure-test first — API-contract design question.
- 📋 Phase 6: integration test coverage for refactor-regression class.

---

## Completed This Session (2026-04-16)

Long session focused on Phase 5b. Originally planned as Phase 3 pressure-test + Quick Wins; reality shipped Phase 5b (which subsumed the original Phase 3/4/5 plans because those had already landed earlier on develop as PRs #814/#816/#817 earlier in the day, before this session).

### Phase 5b shipped (PR #818)

- **Core fix**: `users.default_persona_id` is now NOT NULL at DB, Prisma, and TypeScript layers. Closes the Identity Epic's load-bearing structural invariant.
- **CTE bootstrap**: circular-FK between `users` and `personas` solved via single-statement `WITH new_persona AS (...) new_user AS (...) SELECT 1`. Postgres checks IMMEDIATE FK constraints at statement end, so both FK directions resolve atomically without needing DEFERRABLE. Option chosen via council pressure-test — council recommended over deferred CHECK (keeps nullable types) or DEFERRABLE FK (introduces Prisma drift toil).
- **Dead-code removal**: `backfillDefaultPersona` (90 LOC + 4 unit tests) deleted. The null-default scenario it repaired is structurally impossible post-5b. `UserWithBackfillFields` renamed to `UserWithMaintenanceFields`.
- **test-utils**: new `seedUserWithPersona` helper encapsulates the CTE for integration tests. Replaced raw `$executeRawUnsafe` SQL duplication across 9 int test files. Colocated `seed.int.test.ts` verifies the helper end-to-end.
- **Placeholder persona rename**: shell-created users' `"User {discordId}"` placeholder is renamed atomically when the real username arrives via bot-client. Idempotent `updateMany` handles concurrent maintenance calls.
- **Six review rounds**: R1 (shell/upgrade + plan approval), R2 (displayName propagation + sentinel cross-check), R3 (stale comment, PR refs in comments, missing seed test), R4 (`UserWithMaintenanceFields` rename, docs refresh, warn on rename=0), R5 (shell-path P2002 race coverage, UUID-divergence docs, seed.ts mirror comment), R6 (post-merge: "atomically" comment word fix + schema-audit backlog entry).
- **Council pressure-test before implementation**: 5b plan started as 3-write transaction ("option B" — DEFERRABLE FK), council flagged Prisma drift toil and recommended Option C (CTE). Saved an indefinite drift-ignore.json maintenance commitment.

### User-direction inputs that reshaped the epic

- "Phase 5 isn't done until 5b is done." → Phase 5b promoted from deferred-backlog to in-session active.
- "I don't see the point of divergent paths for this." → Phase 5c scope defined mid-session (eliminate shell-creation path entirely, not just paper over it). Reviewer had flagged UUID divergence between shell/full paths as cosmetic; user correctly identified it as symptomatic of a missing abstraction.
- "I worry we'll run into other stuff like this across the codebase." → Schema-audit backlog item added as its own mini-epic after Phase 6 (pattern: schema concessions that paper over missing abstractions tend to cluster; 3 found in 6 months of v3 suggests more).
- "was it necessary to make a new branch?" → Working-style calibration: comment-only and BACKLOG-only changes now default to direct-on-develop, not PR. Cherry-picked R6 fix onto develop (commit `5ef871cab`), deleted throwaway branch.

### Housekeeping

- BACKLOG: added Phase 5c entry (Current Focus) + schema-audit mini-epic (Inbox). Removed stale Phase 5b Inbox entry via the session-end removal gate.
- BACKLOG: Phase 5c description now also documents the `runMaintenanceTasks` two-write atomicity gap (user.update + persona.updateMany, no transaction) — fix is "delete the block" in 5c, not "add a transaction" in 5b.
- Code standards reinforcement: removed 5 `PR #818 review` annotations from test comments (violated `.claude/rules/02-code-standards.md`).

---

## Scratchpad

### Pre-release notes for when beta.99 ships

Unreleased phases bundled for beta.99 (develop → main release):

- **Phase 3** (PR #814): read-only PersonaResolver
- **Phase 4** (PR #816): kill `discord:XXXX` dual-tier personaId format
- **Phase 5** (PR #817): DB-level invariants (Restrict FK, unique constraint, CHECK constraints)
- **Phase 5b** (PR #818): NOT NULL default_persona_id via CTE bootstrap + backfillDefaultPersona deletion

All four include Prisma migrations. Post-deploy ops:

```bash
pnpm ops db:migrate --env dev   # Apply all four migrations to Railway dev
pnpm ops db:migrate --env prod  # Same for prod
```

Release note categories likely to appear:

- **Improvements**: Identity & Provisioning Hardening phases 3, 4, 5, 5b (structural invariants; no user-visible behavior change; bug-class prevention)
- **Database Migrations**: four migrations — Phase 4's `discord:` format removal, Phase 5's Restrict FK + unique + 2 CHECK constraints, Phase 5b's NOT NULL `default_persona_id`

### UUID divergence note (for Phase 5c reviewers)

Shell-created personas have UUID derived from `"User {discordId}"` (the placeholder name), not the later-assigned real username. After the placeholder rename the row has `name = realUsername` but UUID that `generatePersonaUuid(realUsername, userId)` would NOT produce. Cosmetic only — no production code looks up personas via username-derived UUIDs. Phase 5c's removal of the shell path makes all future users conform to the full-path convention (UUID derived from real username).

### Phase 5c council-question checklist

Pressure-test these questions before writing code:

1. **Where does "user must be provisioned" live?** Middleware (per-route invariant) vs. per-handler call vs. auth-extension (session enrichment)? Each has different failure modes when the invariant is violated.
2. **Does bot-client always have username/displayName at slash-command dispatch?** Discord interaction payload includes them, but need to verify for button/select-menu interactions where the original command's user context may have to be re-fetched.
3. **What's the contract when api-gateway receives a request for a non-provisioned user?** 404? 412 Precondition Failed? Auto-provision with a synthetic placeholder (defeats the purpose)?
4. **How does the cutover work?** Ship bot-client pre-provisioning first, wait a day to ensure all flows provision, THEN flip api-gateway routes to `findUserByDiscordIdOrFail`. Sequencing matters.

---

## Unreleased on Develop (since beta.98)

- **Phase 3** (PR #814): `PersonaResolver.setUserDefault` lazy mutation eliminated.
- **Phase 4** (PR #816): `discord:XXXX` dual-tier personaId format killed.
- **Phase 5** (PR #817): DB-level Restrict FK + unique constraint + 2 CHECK constraints on personas.
- **Phase 5b** (PR #818): NOT NULL default_persona_id + CTE bootstrap + backfillDefaultPersona deletion + test-utils seed helper.
- **docs**: post-release review observations from PR #812 (commit `8928204da`); Phase 5b R6 polish + schema-audit backlog entry (commit `5ef871cab`).

---

## Previous Sessions

- **2026-04-16**: **Identity epic Phase 5b** — PR #818 (NOT NULL default_persona_id, CTE bootstrap, backfillDefaultPersona deletion, seedUserWithPersona helper). Six rounds of review feedback addressed.
- **2026-04-15**: **Identity epic Phase 2 + beta.98 release bundle** — PRs #807, #808 (Phase 2), #809 (cross-channel security), #810 (MEDIA_NOT_FOUND regex), #811 (abbreviation periods in mentions), #812 (release).
- **2026-04-14**: **Identity epic Phase 1** + vision retry fix + TTS budget fix + release (PRs #802-#806), beta.97.
- **2026-04-13**: Backlog shrinkage (PRs #794-800), deps update, preset UX, beta.96.
- **2026-04-12**: Voice engine hardening (PR #785), Python hooks, release audit, beta.95.
- **2026-04-11**: CPD Session 1 (PRs #778-780), channel rename (#781), doc audit (#782-784).
- **2026-04-10**: Browse Step 8 (PR #776), CPD 137→126.

## Recent Releases

- **v3.0.0-beta.98** (2026-04-15) — Cross-channel permission guard (security), MEDIA_NOT_FOUND regex fix, abbreviation-period mention matching, Phase 2 Identity Hardening (provisioning choke point + `ProvisionedUser` type + ESLint guard).
- **v3.0.0-beta.97** (2026-04-14) — Identity & provisioning heal (14 users), vision retry classifier fix + telemetry, TTS budget unification, pytest security bump.
- **v3.0.0-beta.96** (2026-04-13) — Mention parser fixes, forwarded messages, preset error surfacing, deps update, refactors.
- **v3.0.0-beta.95** (2026-04-12) — Voice engine lazy loading, ElevenLabs abort fix, CPD Session 1, browse epic, doc audit.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [epic-identity-hardening.md](docs/reference/architecture/epic-identity-hardening.md) - Phase 5c / 6 entry points
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
