# Current

> **Session**: 2026-04-20 (in flight)
> **Version**: v3.0.0-beta.101 (released 2026-04-20 — everything below shipped to prod)

---

## Next Session Goal

_Start Phase 6 (integration tests). PR C is blocked on prod canary verification — which can't happen until PR A + PR B ship to prod. Phase 6 is the unblocked Release 1 work._

1. **Phase 6 — integration test coverage for the refactor-regression class (~2 days).** Goal: the `c88ae5b7` class of regression fails loudly in tests. End-to-end test exercising "user hits HTTP route → later Discord interaction → system prompt correctness assertion." Path-agnostic so tests survive PR C's deletion of the shell path. Entry point: `docs/reference/architecture/epic-identity-hardening.md § Phase 6`.
2. **Or**: wait for dev Railway deploy + observe PR B's `[Identity] Shell path executed` canary log before starting Phase 6. The canary observation is the empirical input for PR C. Deploying unreleased develop to dev Railway is one `pnpm ops deploy` away.
3. **Or**: cut Release 1 early (PR A + PR B + Phase 6 once ready) to get prod canary data sooner. Trade-off: releases are an event each, so bundling all three is the documented plan — but Phase 6 is the only remaining bundled item.

## Active Task

🏗 **Identity & Provisioning Hardening Epic — Phase 5c in-flight (2 of 3 sub-PRs shipped to develop).**

Epic status:

- ✅ Phase 1 (PR #803, beta.97): tactical heal for persona-snowflake bug. 14 users healed in prod.
- ✅ Phase 2 (PRs #807, #808, beta.98): single choke point for user creation, `ProvisionedUser` return type, ESLint guard on direct `prisma.user/persona.create`.
- ✅ Phase 3 (PR #814, beta.99): eliminated `PersonaResolver.setUserDefault` lazy mutation — read-only resolver, persistence moved to UserService.
- ✅ Phase 4 (PR #816, beta.99): killed `discord:XXXX` dual-tier personaId format.
- ✅ Phase 5 (PR #817, beta.99): DB-level invariants — Restrict FK on `user.default_persona_id`, unique `(owner_id, name)` on personas, CHECK constraints.
- ✅ Phase 5b (PR #818, beta.99): NOT NULL on `users.default_persona_id` via single-statement CTE bootstrap.
- ✅ **Phase 5c PR A (PR #829, develop)**: bot-client sends `X-User-Username` + `X-User-DisplayName` headers. `GatewayUser` type in common-types. 187 files, 3 review rounds.
- ✅ **Phase 5c PR B (PR #830, develop)**: gateway-side `requireProvisionedUser(prisma)` middleware + shell-path canary. 76 files, 3 review rounds. Includes WeakMap UserService cache optimization from R2 review.
- 📋 **Phase 5c PR C (blocked on canary)**: swap handlers to `req.provisionedUserId`, delete shell path. See Active Epic section of BACKLOG for the expanded sub-scope (double-UserService cleanup, isBot tightening, drift-sync, relation tightening, test-utils package-graph cleanup).
- 📋 **Phase 6 (unblocked)**: integration test coverage for refactor-regression class.

---

## Completed This Session (2026-04-18)

Very long session. Started as "take inventory and plan today," ended with two sub-PRs of Phase 5c shipped to develop, a detailed PR C plan in BACKLOG, and the Monitor permission config added.

### Backlog hygiene pass

- Removed 5 stale items already shipped in beta.99 / beta.100 (character field silent-truncation, PersonaResolver focus-mode query collapse, preset clone auto-numbering, flaky xray analyzer test, preset save errors opaque). Each verified shipped by grepping the actual code/commits before deletion.
- Bumped `BACKLOG.md` header dates + version.
- Updated "Standardize over-long field handling" entry from 1-consumer (memory) to 2-consumer (memory + character), tagged as rule-of-three watch.
- Net: -95/+6 lines.

### Phase 5c council consultation (Gemini 3.1 Pro Preview)

- Pressure-tested three API-contract options for "where does 'user must be provisioned' live": (A) gateway middleware, (B) per-handler call, (C) auth-extension with bot-client sending context headers.
- Council landed on **Option C (read-through provisioning middleware)**. Bio dropped from contract (already unused on updates). URI-encoding mandatory for non-Latin-1 chars. Shadow-mode cutover with canary telemetry inside `getOrCreateUserShell` itself (not in the new middleware — avoids false negatives from missed mounts).
- DB verification: **0 dormant shell users on dev**. Collapsed the "dormant shell user migration" from its own sub-phase into a conditional check at cutover time.

### PR A shipped (PR #829, merged)

- bot-client threads `GatewayUser` through its HTTP stack. `toGatewayUser(user: DiscordUser): GatewayUser` helper centralizes the `globalName ?? username` fallback. Two new headers URI-encoded.
- 187 files changed — almost entirely mechanical signature propagation. Delegated Tier 4 (command handler callsites) + Tier 5 (test updates) + spec-only typecheck errors to three general-purpose agents in sequence. Over-match regressions caught and fixed.
- 3 review rounds. R1 surfaced the mock-duplication problem — migrated 73 test files to `vi.importActual` pattern in one pass. Moved `GatewayUser` interface to `common-types` for PR B's benefit.

### PR B shipped (PR #830, merged)

- `requireProvisionedUser(prisma)` middleware in AuthMiddleware.ts with full graceful-degradation: missing headers → warn + next, malformed URI → warn + next, getOrCreateUser throws → warn + next, null return (bot) → warn + next. Never 4xx.
- Mounted on 33 user-scoped routes. 37 test files updated with pass-through mock.
- Canary `logger.warn('[Identity] Shell path executed', { discordId, stack })` inside `UserService.getOrCreateUserShell` — top 6 frames only (R2 perf optimization).
- **WeakMap UserService cache** (R2 fix): `userServiceByPrisma` caches UserService by PrismaClient reference so multiple factory calls with the same client share ONE UserService + cache. Fixes the 12-cache-instances problem in multi-endpoint route files like `memory.ts`.
- `.claude/rules/01-architecture.md` updated with "Request Enrichment" section documenting `req.userId` vs `req.provisionedUserId`.
- 3 review rounds. Final verdict: "No blocking issues."

### Operational / harness

- Added `"Monitor"` to allow list in both `.claude/settings.json` (tracked) and `~/.claude/settings.json` (global). Eliminates permission prompts for polling/wait operations. Since Bash was already unscoped-allowed, zero incremental trust.

### Backlog updates

- PR C sub-scope expanded in the Active Epic section with concrete bullets: double-`UserService` cleanup (wallet/setKey + llm-config), isBot tightening, graceful-degradation → strict 400, username drift-sync, `User.defaultPersona` relation tightening, test-utils package-graph cleanup.
- Epic status line updated to reflect PR A/B shipped to develop.

---

## Scratchpad

### PR B canary verification recipe (for next session or whenever prod deploy happens)

- After PR A + PR B ship to prod, tail api-gateway logs for `'[Identity] Shell path executed'`.
- Expected: non-zero initially (deploy-transition window with old bot-client instances). Should trend to zero as bot-client cycles through.
- Zero hits for 48-72h → PR C is unblocked.
- If the canary stays non-zero after bot-client rollout, the top-6-frames stack trace in each log line identifies the route that still reaches the shell path (either a handler that short-circuits around the middleware, or a route that forgot the mount).
- Dev Railway check: `pnpm ops logs --env dev --filter "@api-gateway" | grep "Shell path executed"`.

### Open PR C design questions (to pressure-test when PR C starts)

1. **Where does the cutover order go?** 33 routes need `getOrCreateUserShell(req.userId)` → `req.provisionedUserId`. Do all at once, or by file? The provisioning middleware already attaches `req.provisionedUserId` so each route can switch independently.
2. **How to handle the 400-rejection tightening gracefully?** Right now middleware falls through on missing headers. Switching to 400 means OLD bot-client versions that haven't updated to PR A would break. Should be safe after prod observation confirms all traffic carries the new headers.
3. **Username drift-sync scope**: fire-and-forget in middleware vs. a BullMQ repeatable job? Council favored async fire-and-forget; worth revisiting.
4. **adminFetch/requireOwnerAuth path**: admin routes use a separate auth middleware and have bot-owner-only semantics. Do we need a sibling `requireProvisionedOwner` middleware? Or do admin endpoints just trust the existing auth without provisioning?
5. **Dormant shell user policy** (prod): zero on dev, but prod may have non-zero. Check with the count script at PR C-start time; if > 0, decide migrate-via-Discord-API vs. accept-garbage-names.

### Release 1 bundling plan (unchanged)

Release 1 = PR A (shipped to develop) + PR B (shipped to develop) + Phase 6 (not started). Hold prod deploy until all three land, OR decide to cut early for canary-observation purposes. User preference last time: hold for full bundle.

---

## Unreleased on Develop (since beta.101)

_Nothing yet — beta.101 just shipped._

---

## Previous Sessions

- **2026-04-18 (this session)**: **Phase 5c PR A + PR B shipped to develop** — PR #829 (bot-client user-context headers, `GatewayUser` in common-types, URI-encoding), PR #830 (gateway shadow-mode middleware + canary, WeakMap UserService cache, route mounts on 33 files). Council pressure-test landed Option C. Backlog hygiene sweep. Monitor permission config. 6 review rounds total across both PRs — every substantive item addressed.
- **2026-04-17**: **Phase 5b shipped + beta.99 release** — PR #818 (Phase 5b NOT NULL + CTE bootstrap), PR #819 (beta.99 bundling phases 3/4/5/5b/#813/#815 + CVE bumps). Prod migrated, tag + GitHub release published.
- **2026-04-15 / 2026-04-16**: Identity epic phases 3/4/5 + beta.98 release bundle.
- **2026-04-14**: Identity epic Phase 1 + vision retry fix + TTS budget fix + release (PRs #802-#806), beta.97.
- **2026-04-13**: Backlog shrinkage (PRs #794-800), deps update, preset UX, beta.96.
- **2026-04-12**: Voice engine hardening (PR #785), Python hooks, release audit, beta.95.
- **2026-04-11**: CPD Session 1 (PRs #778-780), channel rename (#781), doc audit (#782-784).

## Recent Releases

- **v3.0.0-beta.101** (2026-04-20) — Preset clone phantom PK collision (UUIDv7 + unique(owner,name) + server-side suffix bumping), ReDoS fix on clone-name regex, preset back-to-browse + admin-delete via new `renderTerminalScreen` helper + structural test, `/character list`→`/browse` stale-reference sweep, GLM-4.5-air history-regurgitation fix (cross-turn detection widened 5→25), TTS Opus transcode by default (17-min-per-file instead of 2-min), echo-strip for `glm-4.5-air:free`, Phase 5c PR A/B shadow-mode provisioning + WeakMap user cache, echo-strip shared mention-skip utility, PR-monitor hook infrastructure (rule + skill + PostToolUse hook). Migration: `@@unique([owner_id, name])` on `llm_configs` (applied to dev+prod).

- **v3.0.0-beta.100** (2026-04-17) — Two prod blockers fixed (`/admin db-sync` Ouroboros Insert refactor + `/settings preset default` RFC-4122 UUID repair), character field silent-truncation warning flow (PR #825, two-click opt-in), PersonaResolver focus-mode query collapse, typed `NAME_COLLISION` sub-code, preset clone auto-numbering, protobufjs CVE. Migration: circular FKs made DEFERRABLE. New PGLite int test for db-sync class-of-bug. New 00-critical.md rule: "Don't Present Speculation as Fact".
- **v3.0.0-beta.99** (2026-04-17) — Identity Epic Phases 3-5b, UX polish bundle, db-sync deferred-FK fix, hono/langsmith CVE bumps.
- **v3.0.0-beta.98** (2026-04-15) — Cross-channel permission guard (security), MEDIA_NOT_FOUND regex fix, abbreviation-period mention matching, Phase 2 Identity Hardening.
- **v3.0.0-beta.97** (2026-04-14) — Identity & provisioning heal (14 users), vision retry classifier fix + telemetry, TTS budget unification, pytest security bump.
- **v3.0.0-beta.96** (2026-04-13) — Mention parser fixes, forwarded messages, preset error surfacing, deps update, refactors.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [epic-identity-hardening.md](docs/reference/architecture/epic-identity-hardening.md) - Phase 5c / 6 entry points
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
