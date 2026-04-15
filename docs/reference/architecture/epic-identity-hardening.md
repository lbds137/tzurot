# Epic: Identity & Provisioning Hardening

> **Status**: Active Epic. Phase 1 shipped 2026-04-14 (PR #803, beta.97).
> Phases 2-6 queued pending MCP council review.
>
> **Type**: Living document. Update after each phase with outcomes, design
> decisions, and next-phase entry points. This is the source of truth for
> epic-level narrative — BACKLOG.md tracks structure, this tracks rationale.

## Why this epic exists

On 2026-04-14, a production incident surfaced: a new user interacting with
`@baphomet` in a multi-user channel was entirely missing from the system
prompt's `<participants>` section. The AI conflated them with the bot
operator (who was also in the channel), leading to identity confusion in
an emotionally sensitive exchange.

**Root cause chain** (diagnosed during the same session):

1. Refactor `c88ae5b7` (2025-12-20, "centralize user creation through
   UserService") routed api-gateway HTTP-route user creation through
   `UserService.getOrCreateUser(discordId, username, ...)`. The wrapper
   `getOrCreateInternalUser(discordUserId)` — which has no access to the
   real Discord username — passed `discordUserId` as BOTH the ID AND the
   username argument.
2. `UserService.createUserWithDefaultPersona` baked that value into
   `Persona.name`, `Persona.preferredName`, and `Persona.content=""`.
3. Later, `runMaintenanceTasks` upgraded `User.username` to the real
   Discord username, but Persona fields were never touched.
4. When the user sent a message, `MemoryRetriever.getAllParticipantPersonas`
   silently dropped them via the `personaData.content.length > 0` gate,
   leaving no identity signal in the prompt.
5. AI fell back to content-pattern heuristics for identity → confusion.

Undetected for ~4 months (14 users affected, 6% hit rate — only users
who hit api-gateway routes before their first Discord interaction).

## Scope of the epic

The tactical fix shipped in Phase 1 addresses the immediate regression.
The rest of the epic addresses the **structural conditions** that made
this bug possible and went-undetected:

- Three services independently own user provisioning (`UserService`,
  `PersonaResolver`, `api-gateway`), each with slight divergence.
- Repair-on-read (`runMaintenanceTasks`, `backfillDefaultPersona`) patches
  write-time bugs after the fact rather than preventing them at write time.
- Deterministic UUIDs create "ghost" records where a UUID can be valid
  without a DB row behind it.
- Dual-tier personaId resolution (`UUID` vs. `discord:XXXX`) in extended
  context adds ambient complexity.
- No integration test catches the specific refactor class that broke here
  (end-to-end: user first hits HTTP route → later interacts via Discord →
  check system prompt correctness).

## Phases

### Phase 1 — Tactical heal ✅ (PR #803, shipped in beta.97)

- `UserService.getOrCreateUserShell`: new method for User-only creation
  on HTTP routes without username context. Persona is backfilled later
  when bot-client interacts with real username.
- `api-gateway/userHelpers.ts:getOrCreateInternalUser` switched to shell
  method; no more snowflake-as-username.
- `MemoryRetriever.getAllParticipantPersonas`: empty content no longer
  drops participants; only truly-null persona records are excluded.
- One-off migration `scripts/migrations/heal-persona-snowflake-names.ts`
  (deleted post-run) healed 14 affected users in dev + prod.

**Outcome**: 0/226 personas have snowflake `name` or `preferredName`
post-migration. Bug path closed. Next-interaction auto-heal works via
existing `runMaintenanceTasks`.

**PR #804 follow-ups** (also shipped in beta.97):

- Drop `userCache.set` from shell path (singleton-hazard prevention)
- DRY'd `P2002` race recovery into `fetchExistingUserAfterRace` helper

### Phase 2 — Unify user provisioning (~1 week, PENDING council review)

**Goal**: Single choke point for user creation. No direct
`prisma.user.create` outside `UserService`. All callers use one of the
two documented entry points (`getOrCreateUser` full, `getOrCreateUserShell`
HTTP).

- Audit + eliminate direct `prisma.user.create` in test files
- CI rule (lint/depcruise) banning `prisma.user.create` imports outside
  `UserService`
- Return a typed `ProvisionedUser` certificate from `getOrCreateUser`
  (non-nullable `defaultPersonaId`) so callers can't silently consume a
  shell user where a full one was expected

### Phase 3 — Eliminate `PersonaResolver.setUserDefault` side effect (~3 days)

**Goal**: Resolution is read-only. Side effects happen at request boundary.

- Extract `ensureDefaultPersona()` as an explicit method
- Call it at request-end (e.g., message handler wrap-up) rather than
  mid-resolution
- Failures become observable (logged/alerted) rather than swallowed

### Phase 4 — Kill `discord:XXXX` dual-tier format (~3 days)

**Goal**: PersonaId is always a UUID. No placeholder strings in memory.

- Resolve extended context participants to UUIDs at fetch time, not
  resolve time
- If a user can't be resolved, exclude them from extended context (don't
  carry a placeholder)
- Remove `resolveToUuid`'s `discord:` branch after migration window

### Phase 5 — DB-level invariants (~1 day + migration)

- FK constraint: `User.defaultPersonaId → Persona.id` (`ON DELETE RESTRICT`)
- Unique index: `(ownerId, name)` on Persona table
- Review and add `CHECK` constraints where appropriate (non-empty names,
  name doesn't match snowflake pattern, etc.)

### Phase 6 — Integration test coverage for refactor class (~2 days)

**Goal**: The `c88ae5b7` class of regression fails loudly in tests.

- End-to-end test: user hits HTTP route → later Discord interaction →
  assert `<participants>` correctness in generated prompt
- Test fixture for "new user via HTTP first" vs. "new user via Discord
  first" paths
- Contract test between `UserService.getOrCreateUser` callers and
  Persona assumptions downstream

## Cross-cutting principles (apply to every phase)

- **CPD reduction bundled in** — opportunistic CPD cleanup in files the
  epic touches. Not chasing CPD standalone, but not leaving duplicates
  behind.
- **ADR when an architectural choice is made** — new template at
  `docs/reference/templates/adr-template.md`. Any time a Phase introduces
  a pattern that shapes future code (e.g., "all provisioning goes through
  X"), write an ADR.
- **Council review before each phase starts** — pressure-test the specific
  phase's design choices before locking them in. Vision + TTS + persona
  fixes in beta.97 all benefited from council pressure-testing at the
  plan stage.

## Decisions made so far

### D1 (Phase 1) — Shell vs. full creation split

**Chose**: Two distinct `UserService` methods (`getOrCreateUserShell`
vs. `getOrCreateUser`) rather than a nullable `username` parameter on
a single method.

**Rationale**: Nullable-parameter flavor hides the semantic difference.
Two methods with different signatures prevent the original bug from
re-occurring via a `null`-passed-as-username path. Compile-time
enforcement of intent.

### D2 (Phase 1) — Heal via one-off migration, not read-time repair

**Chose**: Script ran once against dev+prod, then deleted from repo
per `07-documentation.md` lifecycle rule.

**Rationale**: 14 users is a bounded set. A read-time repair path
would add another `runMaintenanceTasks`-style patch that runs forever
on every user lookup, which is exactly the architectural debt this
epic is trying to reduce. One-off migration + confidence the bug path
is closed is cleaner.

### D3 (Phase 1) — Empty-content participant included, not dropped

**Chose**: `MemoryRetriever.getAllParticipantPersonas` now includes
participants whose persona has empty `content`, logging a `warn` for
visibility.

**Rationale**: Identity (name, pronouns, guild info) is valuable to
the LLM even without a bio. The silent drop was masking identity gaps.
Fail loud, don't fail silent.

## Related backlog items

See `BACKLOG.md` Icebox/Inbox for:

- Singleton-hazard guard for `UserService` cache (if ever promoted to
  singleton, revisit the shell-path cache omission)
- Post-Phase-6 ADR: "integration-test-coverage pattern for refactor
  regressions" — document the testing pattern that emerges from Phase 6
  so future refactors get the same safety net

## References

- Post-mortem: (to be written at `docs/incidents/` when epic completes —
  the Phase 6 integration test is part of the post-mortem prevention
  strategy)
- Tactical fix PR: #803
- Follow-up PR: #804 (quick-win bundle including Phase-1-adjacent cleanup)
- Beta.97 release: `v3.0.0-beta.97`
- Architectural audit that informed the phases: conducted 2026-04-14
  session (not checked in; distilled into this doc's Phase 2+ scope)
