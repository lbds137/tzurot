# Current

> **Session**: 2026-04-21 (tech-debt paydown, no release cut)
> **Version**: v3.0.0-beta.102 (released 2026-04-20 — still current; nothing released today)

---

## Next Session Goal

_Pick based on energy. TTS cost pressure is the single most urgent external driver, but Identity Hardening must finish first (explicit user preference: don't leave an epic unfinished)._

1. **Identity Hardening Phase 6** — integration test coverage for the refactor-regression class. Phase 5c PR C is still blocked on the prod canary observation window; Phase 6 is the unblocked epic work. Entry: `docs/reference/architecture/epic-identity-hardening.md § Phase 6`. A plan already exists at `/home/deck/.claude/plans/snuggly-popping-clock.md` for Phase 5c PR C when it unblocks (migrate all 14 `getOrCreateUserShell` callers to `req.provisionedUserId` in one pass).
2. **Phase 5c PR C** — only if 48–72h have passed with zero `[Identity] Shell path executed` hits in prod logs since beta.99. Tail: `pnpm ops logs --env prod --filter "@api-gateway" | grep "Shell path executed"`. Zero hits → cutover unblocked. Plan in `snuggly-popping-clock.md`.
3. **Remaining quick wins** (from today's session, unshipped):
   - PR #864 follow-up: ReDoS regex-plugin rule comment compression + regression tests.
   - PR #862 follow-up: encoding tests for SSRF sweep.
   - PGLite shared test factory (pulled from Inbox as Quick Win candidate).
   - 8MB/8MiB terminology audit.
   - ApiCheck autocomplete caches (autocomplete cache miss flagged in Inbox).
   - Automate release step 5 (CURRENT.md Unreleased-section reset).
   - `release:verify-notes` command.
   - Extract `TimeoutError` to common-types.
   - Tighten `maxAge` default.
   - Pino log-level drift investigation (5 info/debug sites bypass ESLint rule — see below).
4. **TTS Epic (Next Epic)** — Chatterbox Turbo primary candidate, Voxtral/Gemini 3.1 Flash TTS/Fish Audio as BYOK alternates. Cost-driven (~$200/mo ElevenLabs). Don't start until Identity Hardening closes.

## Active Task

🏗 **Identity & Provisioning Hardening Epic — Phase 5c in-flight (2 of 3 sub-PRs shipped to develop); Phase 6 unblocked.**

Epic status:

- ✅ Phase 1 (PR #803, beta.97): tactical heal for persona-snowflake bug. 14 users healed in prod.
- ✅ Phase 2 (PRs #807, #808, beta.98): single choke point for user creation, `ProvisionedUser` return type, ESLint guard on direct `prisma.user/persona.create`.
- ✅ Phase 3 (PR #814, beta.99): eliminated `PersonaResolver.setUserDefault` lazy mutation — read-only resolver, persistence moved to UserService.
- ✅ Phase 4 (PR #816, beta.99): killed `discord:XXXX` dual-tier personaId format.
- ✅ Phase 5 (PR #817, beta.99): DB-level invariants — Restrict FK on `user.default_persona_id`, unique `(owner_id, name)` on personas, CHECK constraints.
- ✅ Phase 5b (PR #818, beta.99): NOT NULL on `users.default_persona_id` via single-statement CTE bootstrap.
- ✅ **Phase 5c PR A (PR #829, develop)**: bot-client sends `X-User-Username` + `X-User-DisplayName` headers. `GatewayUser` type in common-types.
- ✅ **Phase 5c PR B (PR #830, develop)**: gateway-side `requireProvisionedUser(prisma)` middleware + shell-path canary. Includes WeakMap UserService cache optimization.
- 📋 **Phase 5c PR C (blocked on canary)**: swap handlers to `req.provisionedUserId`, delete shell path. Plan at `/home/deck/.claude/plans/snuggly-popping-clock.md` — migrate all 14 call sites in one pass, not just the 3 canary-surfaced ones (per standardization preference). See Active Epic section of BACKLOG for expanded sub-scope.
- 📋 **Phase 6 (unblocked)**: integration test coverage for refactor-regression class.

**Next Epic (queued): TTS engine migration.** Promoted from Future Themes to Next Epic this session due to ElevenLabs cost pressure (~$200/month). Chatterbox Turbo (350M, MIT, CPU Docker ready) is top candidate from 2026-04-12 research; Voxtral/Gemini 3.1 Flash TTS/Fish Audio as BYOK alternates. Additive design — add alongside Pocket TTS, not a replacement.

**Demoted: CPD Reduction** — moved from Next Epic to Future Themes. Still a durable goal (drive CPD to zero, then enforce), but lower priority than TTS cost relief.

---

## Completed This Session (2026-04-21 — tech-debt paydown, no release)

A full day of post-surgery recovery tech-debt paydown. 10 PRs merged to develop, no release cut (beta.102 is still current prod).

### PRs shipped to develop

- **PR #856** — Dependabot dev-deps PR triage. Rebase + merge.
- **PR #857/858/859/860** — Identity Epic follow-ups + coverage gap fixes. Reviewer caught `adminFetch` follow-up missing from BACKLOG (classic "out of scope in commit message is NOT tracking" failure mode — now rule-enforced).
- **PR #861** — Voice omission bug root-cause fix. Multi-chunk TTS returned WAV because Opus-in-Ogg can't be byte-concatenated. Fixed via `/v1/audio/transcode` endpoint reusing `_encode_opus` helper. Covers two failing samples (11.66 MB + 13.16 MB).
- **PR #862** — SSRF `encodeURIComponent` sweep. Defense-in-depth across dynamic URL segments. Codecov patch failure forced `codecov.yml` blanket "service entry points" exclusion. Reviewer caught comment phrasing tying exclusion to this PR — rewritten as blanket policy.
- **PR #863** — Pino logger-prefix normalization (large mechanical sweep). Reviewer rounds caught a `logContext` regression in `deleteAllAvatarVersions` + 4 more `{error: err-instance}` sites across SessionManager/UserReferenceResolver/ExtendedContextPersonaResolver. Pre-push hook quirk: pipe-buffered `| tail -N` hid "Pre-push checks failed" message — re-pushed cleanly.
- **PR #864** — ReDoS lint plugin (`eslint-plugin-regexp` w/ `no-super-linear-backtracking` + `no-super-linear-move`). Several bounded-quantifier fixes `{1,N}` across regex patterns.
- **PR #865** — Empty-`{}`-arg sweep + ESLint rule narrowing. The rule itself blocked the sweep initially (`:not(ObjectExpression)` too broad). Narrowed to `:matches(Identifier, MemberExpression, TemplateLiteral)` after reviewer rounds. 27 files changed. Round 2 found a missed multi-line `{}, 'msg'` at `ai-worker/src/index.ts:138` + 4 template-literal sites in `CommandHandler.ts` + 1 in `deployCommands.ts`. Round 3 reviewer caught that I'd shipped the fix but forgot to remove the BACKLOG entry (session-end gate violation).

### Backlog triage

- Inbox shrunk from **61 → 19 items**. Preserved full prose when relocating; did NOT condense.
- **TTS promoted to Next Epic** with consolidated scope (Chatterbox Turbo primary + Voxtral/Gemini 3.1 Flash TTS/Fish Audio BYOK candidates).
- **CPD demoted to Future Themes**.
- Active Epic absorbed 5 Phase 5c/6 items.
- 5 new themes added to Future Themes: Preset Cascade Standardization, `/character chat` DMs PersonalityChatManager extract (proper Option D refactor), Schema Audit, Human-Only HTTP Routes, Railway Log Search DX.
- Icebox gained "Triaged from Inbox 2026-04-21" subsection.
- Confirmed 2 dead-weight items: JobTracker orphan sweep (shipped), `ForeignKeyReconciler.ts` (deleted in beta.100).
- Post-PR #865 additions: 2 ESLint rule gap entries — Pino rule doesn't catch info/debug levels (only error/warn); and a CallExpression regression gap to investigate.

### 5 open bug investigations (in Inbox, not yet started)

1. Open Editor cluster (multi-report thread)
2. `glm-4.5-air` model quirks (see auto-memory `project_glm_45_air_quirks.md`)
3. Typing indicator edge case
4. `kimi-k2.6` reasoning-as-plain-text (see auto-memory `project_kimi_k2x_quirks.md`)
5. Dashboard `maxLength` handling

---

## Scratchpad

### PR C canary verification recipe (still valid)

- After PR A + PR B ship to prod, tail api-gateway logs for `'[Identity] Shell path executed'`.
- Expected: non-zero initially (deploy-transition window with old bot-client instances). Should trend to zero as bot-client cycles through.
- Zero hits for 48-72h → PR C is unblocked.
- If the canary stays non-zero after bot-client rollout, the top-6-frames stack trace in each log line identifies the route that still reaches the shell path (either a handler that short-circuits around the middleware, or a route that forgot the mount).
- Dev Railway check: `pnpm ops logs --env dev --filter "@api-gateway" | grep "Shell path executed"`.
- Prod: `pnpm ops logs --env prod --filter "@api-gateway" | grep "Shell path executed"`.

### Open PR C design questions (unchanged from yesterday)

1. **Cutover scope**: per this session's standardization preference, PR C migrates **all 14** `getOrCreateUserShell` call sites in one pass (not just the 3 canary-surfaced). Plan locked in `/home/deck/.claude/plans/snuggly-popping-clock.md`.
2. **How to handle the 400-rejection tightening gracefully?** Right now middleware falls through on missing headers. Switching to 400 means OLD bot-client versions break. Safe after prod observation confirms all traffic carries new headers. Backlogged as a distinct follow-up (Inbox).
3. **Username drift-sync scope**: fire-and-forget in middleware vs. BullMQ repeatable job. Council favored async fire-and-forget; revisit during PR C.
4. **adminFetch/requireOwnerAuth path**: admin routes use separate auth + bot-owner semantics. Sibling `requireProvisionedOwner` middleware, or trust existing auth? Backlogged this session as a distinct follow-up (reviewer-surfaced on #859/#860 region).
5. **Dormant shell user policy** (prod): check with count script at PR C start; if > 0, decide migrate-via-Discord-API vs. accept-garbage-names.

### Release bundling plan (unchanged)

Release 1 = PR A (shipped to develop) + PR B (shipped to develop) + Phase 6 (not started). Hold prod deploy until all three land, OR decide to cut early for canary-observation purposes. User preference: hold for full bundle.

### ESLint Pino rule evolution (for future session if it regresses)

Final selector shape in `eslint.config.js`:

```
'CallExpression[callee.property.name="error"] > *.arguments:first-child:matches(Identifier, MemberExpression, TemplateLiteral)'
'CallExpression[callee.property.name="warn"] > *.arguments:first-child:matches(Identifier, MemberExpression, TemplateLiteral)'
```

Evolution: `:not(ObjectExpression)` (too broad, blocked `logger.warn('static msg')`) → `:matches(Identifier, MemberExpression)` (too narrow, missed template literals) → current. Known gaps backlogged: doesn't cover `info`/`debug` levels + one CallExpression regression path to investigate.

---

## Unreleased on Develop (since beta.102)

Everything in "Completed This Session" above. Next release will be beta.103 when cut.

---

## Previous Sessions

- **2026-04-20 (second session)**: **v3.0.0-beta.102 released to prod.** Kimi K2.5 routing bug triage + PR #853 (removed creation-time auto-pin), hybrid post-action UX bundle, CITEXT name uniqueness migration, deny `/view` Back-to-Browse regression, backlog hygiene, doc layer corrections (Railway auto-deploy placement), ESLint `generateLlmConfigUuid` ban.
- **2026-04-19 / 2026-04-20 (earlier)**: **v3.0.0-beta.101 released.** Preset-clone phantom PK collision fix, ReDoS fix on clone-name regex, preset back-to-browse, `/character list`→`/browse` sweep, GLM-4.5-air history-regurgitation fix, TTS Opus transcode default, PR-monitor hook infrastructure, Phase 5c PR A/B shadow-mode provisioning.
- **2026-04-18**: Phase 5c PR A + PR B shipped to develop (6 review rounds total).
- **2026-04-17**: **Phase 5b shipped + beta.99 release** — PR #818, PR #819 (bundled phases 3/4/5/5b/#813/#815 + CVE bumps).
- **2026-04-15 / 2026-04-16**: Identity epic phases 3/4/5 + beta.98 release.
- **2026-04-14**: Identity epic Phase 1 + vision retry fix + TTS budget fix + beta.97.
- **2026-04-13**: Backlog shrinkage (#794-800), beta.96.
- **2026-04-12**: Voice engine hardening (#785), beta.95.
- **2026-04-11**: CPD Session 1 (#778-780), channel rename (#781), doc audit (#782-784).

## Recent Releases

- **v3.0.0-beta.102** (2026-04-20) — Hybrid post-action UX, personality preset routing fix, CITEXT name uniqueness (`llm_configs.name` + `personas.name`), deny view fixes, ESLint `generateLlmConfigUuid` guardrail.
- **v3.0.0-beta.101** (2026-04-20) — Preset clone PK collision, ReDoS fix, preset back-to-browse, `/character list`→`/browse` sweep, GLM-4.5-air history fix, TTS Opus transcode default, Phase 5c PR A/B, PR-monitor hook infrastructure.
- **v3.0.0-beta.100** (2026-04-17) — `/admin db-sync` Ouroboros refactor, `/settings preset default` UUID repair, character field truncation warning, typed `NAME_COLLISION`, preset clone auto-numbering, protobufjs CVE. Migration: circular FKs made DEFERRABLE.
- **v3.0.0-beta.99** (2026-04-17) — Identity Epic Phases 3-5b, UX polish, db-sync deferred-FK fix, hono/langsmith CVE bumps.
- **v3.0.0-beta.98** (2026-04-15) — Cross-channel permission guard, MEDIA_NOT_FOUND regex fix, abbreviation-period mention matching, Phase 2 Identity.
- **v3.0.0-beta.97** (2026-04-14) — Identity Phase 1 heal (14 users), vision retry classifier, TTS budget unification.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [epic-identity-hardening.md](docs/reference/architecture/epic-identity-hardening.md) - Phase 5c / 6 entry points
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
- `/home/deck/.claude/plans/snuggly-popping-clock.md` — Phase 5c PR C full-migration plan (ready to execute when canary clears)
