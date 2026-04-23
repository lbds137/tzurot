# Current

> **Session**: 2026-04-22 → 2026-04-23 (wrapped; v3.0.0-beta.104 shipped)
> **Version**: v3.0.0-beta.104 (released 2026-04-23 — everything below shipped to prod)

---

## Next Session Goal

_v3.0.0-beta.103 just shipped. Pick based on energy:_

1. **Identity Hardening Phase 6** — integration test coverage for the refactor-regression class. Now fully unblocked: Phase 5c PR C landed and applied to prod, canary log is watchable. Entry: `docs/reference/architecture/epic-identity-hardening.md § Phase 6`. This is the last remaining phase of the Active Epic.
2. **TTS Engine Upgrade (Next Epic)** — Chatterbox Turbo primary candidate. Promoted to Next Epic this session due to ElevenLabs cost pressure (~$200/mo). Additive design: add alongside Pocket TTS, not a replacement. See BACKLOG Active/Next Epic sections.
3. **Inbox triage** — Inbox is back up to 14 items after this session's release-review additions + earlier surfacing. Worth a quick triage pass to categorize.
4. **Quick wins** — several small items remain from yesterday's sweep list (PGLite shared test factory, release:verify-notes command, 8MB/8MiB LLM response audit). See Inbox.

## Active Task

🏗 **Identity & Provisioning Hardening Epic — Phase 5c COMPLETE; Phase 6 is the final remaining phase.**

Epic status:

- ✅ Phase 1 (PR #803, beta.97): tactical heal for persona-snowflake bug. 14 users healed in prod.
- ✅ Phase 2 (PRs #807, #808, beta.98): single choke point for user creation, `ProvisionedUser` return type, ESLint guard on direct `prisma.user/persona.create`.
- ✅ Phase 3 (PR #814, beta.99): eliminated `PersonaResolver.setUserDefault` lazy mutation — read-only resolver, persistence moved to UserService.
- ✅ Phase 4 (PR #816, beta.99): killed `discord:XXXX` dual-tier personaId format.
- ✅ Phase 5 (PR #817, beta.99): DB-level invariants.
- ✅ Phase 5b (PR #818, beta.99): NOT NULL on `users.default_persona_id`.
- ✅ Phase 5c PR A (PR #829, beta.103): bot-client sends user-context headers.
- ✅ Phase 5c PR B (PR #830, beta.103): gateway `requireProvisionedUser` middleware + canary.
- ✅ **Phase 5c PR C (beta.103, shipped 2026-04-22)**: all 14 shell-path callers migrated to `req.provisionedUserId`; `resolveProvisionedUserId` helper centralizes the common-path + shadow-fallback pattern. Shell path remains alive as safety net — final cleanup (delete `getOrCreateUserShell` + canary log entirely) pending zero-canary-hits observation window.
- 📋 **Phase 6 (fully unblocked)**: integration test coverage for refactor-regression class (would have caught `c88ae5b7`). ~2 days.

**Next Epic (queued): TTS engine upgrade.** Chatterbox Turbo primary. Starts after Phase 6.

---

## Completed This Session (2026-04-21 → 2026-04-22)

### v3.0.0-beta.103 shipped to prod (2026-04-22 early AM)

- **Release PR #867** — 57 commits, merged `develop → main` via rebase. Tag + GitHub Release published: https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.103
- **Migration applied**: `20260421164630_llm_config_global_name_unique` (partial unique index). Pre-flight uniqueness check on prod confirmed zero collisions before apply. Clean deploy.
- **Develop rebased onto main** post-merge (per skill step 5), SHA-aligned at `11113919d`.

### Major shipped items

- **Phase 5c PR C cutover** (PR #866 + merged commits): all 14 shell-path callers migrated to `req.provisionedUserId`, `resolveProvisionedUserId` helper extracted, `getOrCreateInternalUser` reads provisioned-defaults from request.
- **Voice multi-chunk TTS Opus fix**: per-chunk WAV + combined buffer → `/v1/audio/transcode` → Opus. Ships the voice-omission-bug fix (11.66 MB + 13.16 MB samples).
- **PR #866 tech-debt sweep** (my main PR this session): 9 commits — ReDoS bounded quantifiers + `eslint-plugin-regexp` lint adoption, `PINO_LOGGER_RULES` extension to info/debug + CallExpression, then selector arity refinement to eliminate spread workaround, `TimeoutError` + `isTimeoutError` + `normalizeErrorForLogging` extracted to `@tzurot/common-types`, SSRF encoding test backfill (5 tests), bounded-regex regression tests (6 tests), 112-site log-call migration to structured fields.
- **Depcruise CI enforcement**: failures now fail the pipeline.
- **`ApiCheck<T>` tri-state type** + NSFW fail-closed fix: transient gateway errors no longer treated as definitive entitlement denials.
- **GLM 4.5 Air `<understanding>` tag** added to `KNOWN_THINKING_TAGS` — third variant patched in the GLM reasoning-tag schema salad pattern (after `<character_analysis>` and namespace prefixes). Incident req `deb8b063-ea7e-40c3-be96-4bdcfc32c453`.
- **Circular dependency fix**: 5 cycles in `deny/` and `character/` modules broken via `browseRebuilder.ts` side-effect registration module.
- **Kimi K2.6 reasoning-did-not-engage per-model telemetry** + SSRF encoding sweep of 14+ admin-side helpers.

### Backlog hygiene

- Inbox shrunk 61 → 19 → 14 items over the session arc (multiple waves of triage + removals + additions).
- Phase 5c/6 items consolidated from Inbox to Active Epic.
- TTS Engine Upgrade promoted to Next Epic; CPD Reduction demoted to Future Theme.
- 7 shipped items removed per session-end removals gate.
- Today's additions: 2 review-surfaced items (sample-rate mismatch test coverage, userHelpers shadow-mode throw context). Both from claude-bot review on release PR #867.

### Deleted

- One-shot `scripts/src/db/check-llm-global-uniqueness.ts` — served its purpose during pre-flight, removed per 05-tooling.md scripts-may-be-one-shot exception.

---

## Scratchpad

### Canary watch (prod, post-release)

Phase 5c PR C shipped to prod with shadow-mode fallback preserved. Expected behavior: `[Identity] Shell path executed` warn-log in api-gateway should trend to zero within ~30-60 min post-deploy as bot-client pods cycle through. Non-zero after bot-client rollout indicates a route missed migration OR the middleware shadow-mode falling through (stack trace in log identifies which).

```
pnpm ops logs --env prod --filter "@api-gateway" | grep "Shell path executed"
```

Zero hits for 48-72h → unblocks the Phase 5c final-cleanup PR (deletes the shell path entirely + canary log). Tracked in Active Epic.

### Phase 6 entry point

Epic's final remaining phase. Integration tests that exercise "user hits HTTP route → later Discord interaction → system prompt correctness" to catch the class of regression that let `c88ae5b7` ship. Estimated 2 days. See `docs/reference/architecture/epic-identity-hardening.md § Phase 6`.

### Dev verification confirmed this session

Three smoke tests passed on dev before prod release:

1. `/settings defaults edit` → round-tripped config-overrides (biggest 6-site migrated cluster)
2. `/preset edit` → llm-config cluster
3. `/settings preset set` → model-override cluster

---

## Unreleased on Develop (since beta.104)

_Nothing yet — just shipped._

---

## Previous Sessions

- **2026-04-21 (first session)**: tech-debt sweep PR #866 — 9 commits across 4 review rounds. ReDoS comment compression, 8 MiB JSDocs, PINO rule extension sweep (112 sites), TimeoutError extraction, SSRF tests, bounded-regex regression tests. Merged cleanly.
- **2026-04-20 (second session)**: **v3.0.0-beta.102 released** — Kimi K2.5 routing bug fix (#853), hybrid post-action UX, CITEXT name uniqueness migration.
- **2026-04-19 / 2026-04-20 (earlier)**: **v3.0.0-beta.101 released** — Preset clone fix, ReDoS, TTS Opus transcode default, PR-monitor hook infrastructure, Phase 5c PR A/B shadow-mode provisioning.
- **2026-04-18**: Phase 5c PR A + PR B shipped to develop.
- **2026-04-17**: **Phase 5b shipped + beta.99 release** — PR #818, PR #819.
- **2026-04-15 / 2026-04-16**: Identity epic phases 3/4/5 + beta.98.
- **2026-04-14**: Identity epic Phase 1 + beta.97.

## Recent Releases

- **v3.0.0-beta.104** (2026-04-23) — shapes.inc cookie migrated Auth0 → Better Auth (users must re-auth via `/shapes auth`); cookie-submit preflight now validates against shapes.inc before persisting; preflight endpoint swapped to `/api/users/info` for fate-sharing with the import fetcher; GLM-4.5-air chain-of-thought no longer leaks to users via fake-user-message XML wrapper (Chain-of-Extractors pattern); new release tooling — `release:draft-notes`, `release:verify-notes`, `release:finalize` commands; bot-client submit-job timeout 10s → 60s (mitigation for attachment-heavy requests; structural fix tracked in Inbox); preset delete defer-first; `maxLength` required at type level on dashboard fields; `createTestPGlite` factory across 16 call sites. **No migrations**.
- **v3.0.0-beta.103** (2026-04-22) — Identity Epic Phase 5c PR C cutover (all 14 shell-path callers migrated to req.provisionedUserId), voice multi-chunk TTS Opus fix (closes 8 MiB attachment limit on long replies), `ApiCheck<T>` tri-state type fixes transient-as-definitive-denial, extensive tech-debt paydown (112-site log migration, ReDoS lint adoption, TimeoutError extraction, SSRF encoding hardening, depcruise CI enforcement). GLM 4.5 Air `<understanding>` reasoning-tag variant patched. Migration: partial unique index on `llm_configs(name) WHERE is_global = true`.
- **v3.0.0-beta.102** (2026-04-20) — Hybrid post-action UX, Kimi K2.5 routing fix, CITEXT name uniqueness.
- **v3.0.0-beta.101** (2026-04-20) — Preset clone PK fix, TTS Opus transcode default, Phase 5c PR A/B.
- **v3.0.0-beta.100** (2026-04-17) — `/admin db-sync` refactor, character truncation warning, protobufjs CVE.
- **v3.0.0-beta.99** (2026-04-17) — Identity Epic Phases 3-5b, UX polish, db-sync deferred-FK fix.
- **v3.0.0-beta.98** (2026-04-15) — Cross-channel permission guard, MEDIA_NOT_FOUND regex fix.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [epic-identity-hardening.md](docs/reference/architecture/epic-identity-hardening.md) - Phase 6 entry point
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
