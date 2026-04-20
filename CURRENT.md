# Current

> **Session**: 2026-04-20 (wrapped)
> **Version**: v3.0.0-beta.102 (released 2026-04-20 — everything below shipped to prod)

---

## Next Session Goal

_Multiple paths are unblocked. Pick based on energy and what's coming next._

1. **Dependabot dev-deps PR** that landed mid-session (`origin/dependabot/npm_and_yarn/develop/development-dependencies-327004958d`). Quick triage: rebase if needed, verify tests pass, merge.
2. **Identity Hardening Phase 6** — integration test coverage for the refactor-regression class. Phase 5c PR C is still blocked on the prod canary observation window; Phase 6 is the unblocked epic work. Entry point: `docs/reference/architecture/epic-identity-hardening.md § Phase 6`.
3. **Phase 5c PR C** — only if 48–72h have passed with zero `[Identity] Shell path executed` canary hits in prod logs since beta.99. Tail with `pnpm ops logs --env prod --filter "@api-gateway" | grep "Shell path executed"`. Zero hits → cutover unblocked.
4. **Quick wins from BACKLOG** if energy is low — candidate quick wins: SSRF encode-dynamic-path-segments (entry on line 76, defense-in-depth), partial unique index on `llm_configs (name) WHERE is_global = true` (line 74, 1-line migration), or Pino logger-prefix normalization (line 86, mechanical sweep).

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

## Completed This Session (2026-04-20 — second session of the day)

Released **v3.0.0-beta.102** to prod after a triage-driven session that started with the Kimi K2.5 routing bug and ended with three PRs merged + the release shipped.

### v3.0.0-beta.102 release (PR #854, merged + tagged)

- 23 commits since beta.101: hybrid post-action UX (#851/#852), back-to-browse fixes for character/persona/deny, citext name uniqueness, preset auto-pin removal, deny `/view` cleanup, dependency bumps, BullMQ type fix, dependabot config consolidation.
- Migration `20260420124923_llm_config_persona_citext_name` applied to dev + prod (CITEXT collision pre-check ran clean — 0 collisions).
- GitHub Release published: https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.102.

### Kimi K2.5 routing bug triage → PR #853

- **Symptom**: user cleared their global default preset but kept getting Kimi K2.5 instead of GLM 5.1.
- **Root cause**: every personality auto-pinned at creation time to whatever was currently the global default. 24 prod personalities fossilized against 4 different historical global defaults — 7 stuck on Kimi K2.5 specifically.
- **Fix**: deleted `setupDefaultLlmConfig` helper + 2 call sites; personalities now cascade to current global default at request time. Cleaned up all 24 stale rows from prod + 1 from dev. Shapes import path preserved (its upsert is deliberate).
- **Backlog spawned**: "Preset cascade standardization" epic — character-tier slash command for opt-in pinning, UX alignment with config-override cascade.

### Deny `/view` Back-to-Browse regression fix

- Today's PR #853 follow-up made `DenyDetailSession.browseContext` nullable for `/deny view` direct-lookup sessions, but the Back-to-Browse button was still rendered unconditionally and dead-ended on "session expired."
- Fix: `buildDetailButtons` now takes `hasBrowseContext: boolean` and omits the button when there's no browse list to return to.

### Backlog hygiene

- Removed 3 obsolete inbox entries (back-to-browse audit shipped via #842/#843/#844 + #851/#852; TerminalAction superseded by registry pattern; 3-line opt-out widening investigated and rejected).
- Removed 1 more entry (ESLint generateLlmConfigUuid ban shipped today via `ca24d6f48`).
- Added 4 new inbox entries from beta.102 RC testing: post-`/character create` no Delete button, `Create` button in `/X browse`, persona create UX inconsistency, bot-owner delete-any-preset.
- Added "Preset cascade standardization" epic candidate.
- Cleaned up 8 AI-slop narrative comments across the codebase (kept ~16 that were legitimate "why" comments using trigger words).
- ESLint `no-restricted-syntax` rule banning new prod callers of `generateLlmConfigUuid` (with `ShapesPersonalityMapper` exception properly justified).
- Deleted 17 stale local branches (16 marked `[gone]` + the post-merge `release/v3.0.0-beta.101` branch).

### Doc layer corrections

- Initial post-release commit dropped Railway auto-deploy info into reference, but procedural content (release sequence) and a duplicated migration constraint slipped in. Audited against `.claude/rules/07-documentation.md` three-layer system and corrected: kept the auto-deploy table (genuinely new fact) in `RAILWAY_OPERATIONS.md`; moved the procedural "run migration on release" guidance into `tzurot-git-workflow` SKILL.md as new step 5; added the auto-deploy table to `tzurot-deployment` SKILL.md so the fact is loaded when actively deploying.
- Updated auto-memory `project_railway_dev_autodeploy.md` to reflect that BOTH environments auto-deploy (was previously dev-only). Now documented in source control too.

### Smaller fixes

- `usedGlobalDefault` log field on `PersonalityService` (review-flagged minor): replaced strict `=== undefined` with truthy check to match Prisma's null-for-missing-relation behavior.
- `.gitignore` added `.claude/scheduled_tasks.lock` (session-local runtime state that snuck into a commit).

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

## Unreleased on Develop (since beta.102)

_Nothing yet — just shipped._

---

## Previous Sessions

- **2026-04-19 / 2026-04-20 (earlier)**: **v3.0.0-beta.101 released to prod.** Bundled: preset-clone phantom PK collision (UUIDv7 + `@@unique(owner_id, name)` + server-side suffix bumping + ReDoS fix on clone-name regex), preset back-to-browse + admin-delete via new `renderTerminalScreen` helper + structural test, `/character list`→`/browse` stale-reference sweep (3 PRs' worth of internal + user-facing references), GLM-4.5-air history-regurgitation fix (cross-turn detection widened 5→25), TTS Opus transcode by default, PR-monitor hook infrastructure (rule + skill + PostToolUse hook), Phase 5c PR A/B (shadow-mode provisioning + WeakMap user cache). Migration `@@unique([owner_id, name])` on `llm_configs` applied to dev+prod. Session-end DM-broken investigation traced to Discord user-install state corruption (deauth + reauth fixed it; not a code issue). Two follow-up items backlogged: Option D refactor for `/character chat` in DMs (council-blessed) + v2 `/cleandm` restoration.
- **2026-04-18**: **Phase 5c PR A + PR B shipped to develop** — PR #829 (bot-client user-context headers, `GatewayUser` in common-types, URI-encoding), PR #830 (gateway shadow-mode middleware + canary, WeakMap UserService cache, route mounts on 33 files). Council pressure-test landed Option C. Backlog hygiene sweep. Monitor permission config. 6 review rounds total across both PRs — every substantive item addressed.
- **2026-04-17**: **Phase 5b shipped + beta.99 release** — PR #818 (Phase 5b NOT NULL + CTE bootstrap), PR #819 (beta.99 bundling phases 3/4/5/5b/#813/#815 + CVE bumps). Prod migrated, tag + GitHub release published.
- **2026-04-15 / 2026-04-16**: Identity epic phases 3/4/5 + beta.98 release bundle.
- **2026-04-14**: Identity epic Phase 1 + vision retry fix + TTS budget fix + release (PRs #802-#806), beta.97.
- **2026-04-13**: Backlog shrinkage (PRs #794-800), deps update, preset UX, beta.96.
- **2026-04-12**: Voice engine hardening (PR #785), Python hooks, release audit, beta.95.
- **2026-04-11**: CPD Session 1 (PRs #778-780), channel rename (#781), doc audit (#782-784).

## Recent Releases

- **v3.0.0-beta.102** (2026-04-20) — Hybrid post-action UX across all four browse-capable commands (preset/character/persona/deny — destructive actions re-render browse list with success banner, one click fewer than terminal-screen-then-Back). Personality preset routing fix: removed creation-time auto-pin to global default that fossilized 24 prod personalities against stale presets (e.g. 7 stuck on Kimi K2.5 after switching to GLM 5.1) — now cascade to current global default at request time. Case-insensitive uniqueness for `LlmConfig.name` and `Persona.name` via citext migration. Deny `/view` → delete renders clean terminal; `/view` Back-to-Browse button conditionally omitted (no list to return to). `usedGlobalDefault` log field correctness fix. ESLint guardrail banning new prod callers of deprecated `generateLlmConfigUuid`. Backlog hygiene (3 obsolete entries dropped, AI-slop comment cleanup). Migration: `LlmConfig.name`/`Persona.name` → CITEXT (applied to dev+prod).

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
