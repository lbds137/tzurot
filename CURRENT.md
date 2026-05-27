# Current

> **Version**: v3.0.0-beta.125 (released 2026-05-22) — Railway prod auto-deploys on main merge. Bundles 8 PRs across schema-audit tooling (#1076), LlmConfig schema tightening + migration (#1077), fixture cleanup (#1078), pre-release admin auth fixes (#1080 isFreeDefault guard + SSRF defense-in-depth, #1081 X-User-Id unification).
> **🚧 Release freeze status**: LIFTED. No release in progress.

---

## Next Session Goal

**Active epic**: **Route Manifest Scaffold + Typed-Client Codegen** ([active-epic.md](backlog/active-epic.md)) — Phase 3 COMPLETE. **PR-1.5g shipped to develop** (PR #1101, merged 2026-05-26) — wired `RouteDef.meta` to codegen JSDoc emission (`@safeRead`/`@softDeleteAware`/`@idempotent`/`@atMostOnce`); new `meta.atMostOnce` tag surfaces the "do NOT auto-retry" contract for token-gated destructive routes; 5 mutual-exclusivity invariant tests; 69 routes tagged; 3 review-surfaced quick-wins absorbed (purge case-insensitivity, batchDelete `::` delimiter, date-schema `.datetime({ offset: true })`). Manifest stays at 141 routes; generated `user-client.ts` gains 81 new JSDoc tag annotations. 5 commits, 4 review rounds; merged at 7420c85c.

**Next under the epic — Phase 4 starts**:

**PR-2: route-prefix cutover + bot-client migration**. Atomic switch from legacy `/admin /user /internal` mounts to generated `mountAdminRoutes/mountUserRoutes/mountInternalRoutes` + migrate all 243 bot-client call sites (38 `adminFetch` + 205 `callGatewayApi`) + delete `adminApiClient.ts`/`userGatewayClient.ts`. Three backlog items already filed under this trigger (wallet rate-limiter middleware, common-types export-count audit, /wallet/set typed-client migration). Naturally splits into ~4-6 smaller PRs (mount cutover transitional dual-mount → per-area bot-client migrations → legacy deletion). Next session opens with the slice-structure proposal.

**Other candidates** (off-epic):

- **Self-Hosted TTS + BYOK Re-Eval — Step 0 BYOK probes** ([future-themes.md](backlog/future-themes.md)) — Cartesia / Fish Audio / PlayHT / Resemble pricing-and-quality pass.
- **Adjacent CPD Follow-Up Campaigns** ([future-themes.md](backlog/future-themes.md)) — four independently-pickable mini-epics from the 2026-05-16 CPD campaign close-out.
- **Quick-win: migrate `/admin/db-sync` + `/admin/cleanup` from body ownerId to X-User-Id header** ([quick-wins.md](backlog/quick-wins.md)) — closes the remaining two-codepath shape in `extractOwnerId`. Surfaced by PR #1081 review.
- **Deferred items with named triggers** ([deferred.md](backlog/deferred.md)) — many are gated on "next time you touch X."

**Verify on prod (low priority, fix shipped)**:

- Multi-personality ping race (shipped in PR #1049 / beta.123) — entry retired from production-issues.md since the fix is live. Ping 2-3 personalities in quick succession with different prompts; each should reply with its own content. Re-add the entry only if the symptom resurfaces.
- `google/gemma-4-31b-it:free` is a real slug (confirmed via preset screenshot 2026-05-19; verify guest-mode vision works in prod for paranoia).

---

## Last Session — PR-1.5d: PR #1097 follow-ups + epic retrofit (2026-05-26)

Closed three follow-up items from PR #1097's review cycle plus retrofitted the active-epic tracker after noticing 6+ PRs had shipped on a cohesive arc with no formal epic.

### PR merged

| PR    | Title                                                                        | Outcome                                                                                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1098 | `fix(api-gateway): wire zod schemas + strong-type ResolveUserConfigDefaults` | Shapes-handler Zod bypass closed (3 handlers); ResolveUserConfigDefaults moved from passthrough to strongly-typed; compile-time collision guard added; backlog −3 entries; active-epic.md retrofitted with all 5 phases |

### Net result

- **Shapes-handler validation gap closed**: `import.ts`, `auth.ts`, `export.ts` switched from `req.body as {...}` casts to `parseBodyOrSendError(res, Schema, req.body)`. Direct API caller passing `importType: 'garbage'` now returns `VALIDATION_ERROR` instead of silently normalizing to `'full'`.
- **`.trim().min(1)` on all three shapes inputs** — rejects whitespace-only strings at the contract layer instead of falling through to downstream format validators. Error category now consistent (`VALIDATION_ERROR` across all three handlers).
- **`ResolveUserConfigDefaultsResponseSchema` strong-typed**: replaced `.passthrough()` with `ConfigOverridesSchema.required().extend({ sources, userOverrides })`. Generated client callers now see `{ maxMessages: number | null, voiceResponseMode: enum, ... }` at root instead of `{ [k: string]: unknown }`.
- **Compile-time collision guard**: `_ReservedKeysDoNotCollide` assertion proves `keyof ConfigOverrides` has empty intersection with `'sources' | 'userOverrides'`. Future field-name collision is now a compile error, not a runtime ambiguity.
- **Epic retrofit**: `backlog/active-epic.md` formalizes Route Manifest Scaffold + Typed-Client Codegen with all 5 phases (Manifest scaffold ✅, Handler refactor ✅, Coverage 🚧, Cutover ⏳, Cleanup ⏳) and the two open design decisions for PR-1.5e/1.5f.
- **6 review rounds**, all converging clean: 3 substantive items addressed + 3 micro-iterations (one nit dismissed in round 2 surfaced again in round 3 with stronger reasoning — applied then).

### Backlog deltas

- `quick-wins.md`: 3 entries removed
  - Shapes-handler Zod bypass (shipped in this PR)
  - `ResolveUserConfigDefaultsResponseSchema` collision-guard (shipped in this PR)
  - Stale `routeDeps.ts` scaffolding removal (handler refactor already wired the interface; structure.test exclusion is the right form)
- `active-epic.md`: replaced placeholder with full Route Manifest Scaffold epic
- Net: −3 entries, 0 added — matches the user directive that "newly added items should generally be tackled under subsequent work"

### Process notes

- The user noticed the missing epic mid-session — first time formalizing it after PR-1.0, PR-1.5a, PR-1.5b.2a #1093, PR-1.5b.2b #1094, PR-1.5c #1097 already shipped uncovered. Now traceable.
- Saved memory entry `feedback_council_models_for_design.md` capturing the user's preferred council lineup (GLM 5.1, Kimi K2.6, Qwen 3.7 Max) for the upcoming PR-1.5e/1.5f design decisions.

---

## Previous Session — PR-1.5c: 36 missing user-route manifest entries (2026-05-26)

Marathon session shipping the PR-1.5 epic's largest single PR: filled in the 36 user-audience routes that had working server handlers but no manifest entries, so the route-manifest codegen now covers them.

### PR merged

| PR    | Title                                                                           | Outcome                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1097 | `feat(common-types): PR-1.5c — add manifest entries for 36 missing user routes` | Manifest 92 → 128 routes; resources.ts split into 6 sub-files; codegen learns required-vs-optional query param distinction; 4 schema bugs caught post-autosquash and fixed |

### Net result

- **Manifest coverage**: 128 routes (10 internal, 27 admin, 91 user) — ~75% of the user surface area now codegen-typed
- **File split**: routes/user/resources.ts (was 499 lines) → ownership.ts + resources.ts + memory.ts + config-overrides.ts + shapes.ts + diagnostics.ts (all under 400-line limit)
- **Codegen improvements**: `isOptionalZod` now correctly distinguishes `z.string()` (required) from `.optional()` / `.default()` (optional) — generated `client.getHistoryStats({ ... })` now refuses to omit required query params at compile time
- **4 schema bugs caught post-autosquash**: `listPersonaOverrides` wrong output schema, `ShapesImportJobSummary` non-nullable counts on `Int?` columns, `startShapesImport`/`startShapesExport` missing `input:` schemas, `setWalletKey` registered at `/wallet` instead of `/wallet/set`. Reading the post-autosquash review caught all four before merge
- **Dead code removed**: `types/schemas/historyApi.ts` (stale schemas missing `personaId`/`personaName`; zero consumers)
- **17 review rounds, 5,500+ diff lines, 36 routes** — heavy iteration but every concern resolved

### Backlog deltas

- `quick-wins.md`: 3 follow-up entries filed
  - Shapes-handler Zod bypass (input schemas decorative — handlers cast `req.body as {...}` manually)
  - Wallet rate-limiter cutover risk (`router.use(...)` middleware not emitted by codegen)
  - `ResolveUserConfigDefaultsResponseSchema` collision-guard + type-inference tightening
- `current-focus.md`: no changes (PR-1.5c was an opportunistic standalone PR, not part of a tracked epic)

### Deferred to PR-1.5d (or later)

- /user/memory main CRUD (~10 routes — dynamic-filter pattern needs design)
- /admin/diagnostic audience lift (5 routes — needs decision)

---

## Earlier Session — Quick-wins + auth symmetry sweep (2026-05-20)

Three-PR sweep: internal observability (`/admin metrics`), closing the last API Security Hardening item (`/voice-references` service auth), then a follow-up to eliminate the auth-posture asymmetry that surfaced during PR #1068 review.

### PRs merged

| PR    | Title                                                           | Outcome                                                                                          |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| #1067 | `feat(bot-client): /admin metrics command`                      | Bot-owner-only slash command renders queue/cache/uptime metrics in an ephemeral embed            |
| #1068 | `fix(api-gateway): protect /voice-references with service auth` | Slug-enumeration attack surface closed; ai-worker now gates startup on `INTERNAL_SERVICE_SECRET` |
| #1069 | `fix: symmetric INTERNAL_SERVICE_SECRET startup validation`     | api-gateway warn → throw; bot-client gains startup check matching ai-worker (#1068)              |

### Net result

- **API Security Hardening theme fully closed.** All three items shipped (rate limiter #1046, helmet/CORS #1046/#1048, voice-references service auth #1068). Theme section removed from `future-themes.md`.
- **Defense-in-depth on auth misconfig**: ai-worker now validates `INTERNAL_SERVICE_SECRET` at process startup (`validateRequiredEnvVars`) AND at call-site in `voiceReferenceHelper` — misconfig fails the boot instead of silently degrading TTS.
- **Symmetric auth posture across services**: api-gateway, bot-client, and ai-worker all refuse to boot without `INTERNAL_SERVICE_SECRET`. Identical error messages across services make log-grep trivial during incident triage.
- **Internal observability surface added**: `/admin metrics` slash command mirrors the existing `/admin health` pattern.

### Backlog deltas

- `current-focus.md`: voice-references enumeration item removed (shipped via #1068)
- `quick-wins.md`: `/admin metrics` entry removed (shipped via #1067)
- `icebox.md`: rate-limit voice-references item removed (concern moot now that route requires service auth)
- `future-themes.md`: API Security Hardening theme section removed entirely
- `next-theme.md`: API Security Hardening dropped from candidates list

### Backlog state at session close

- **Production issues**: 0 active
- **Inbox**: empty
- **Current focus**: empty (open-pick next session)
- **Quick wins**: 0 active
- **Active epic**: none
- **Deferred**: 89 trigger-gated items
- **Future themes**: 22 queued (API Security Hardening removed)

---

## This Morning — Post-release polish (2026-05-21)

Closed the 3 inbox items filed during the v3.0.0-beta.124 release-cycle reviews. One bundled PR:

| PR    | Outcome                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1073 | GatewayClient timeouts → named `TIMEOUTS.*` (3 new constants); `?? ''` fallback → `getValidatedServiceSecret()` helper (10 sites); `/admin metrics` single-dispatch refactor + regression test |

Net result: bot-client/utils is internally consistent, no more inline magic numbers for timeouts, no silent-401 risk from empty service-auth headers, no wrong-attribution failure mode on `/admin metrics` non-OK responses. Backlog inbox cleared.

These will ship in beta.125 whenever it's cut; no release cadence pressure.

---

## Prior Session — MultiTagRecovery hardening chain (2026-05-19, evening)

Five PRs shipped in sequence, each addressing a distinct layer of the multi-tag rehydration problem first surfaced by the beta.123 deploy incident at 05:16 UTC.

### PRs merged

| PR    | Title                                                                    | Layer addressed                                                                                                                            |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| #1062 | `fix(bot-client): render personality voice on safety-timeout errors`     | UX symptom — persona-voice fallback when safety timeout fires (pre-evening, captured for context)                                          |
| #1063 | `fix(bot-client): poll BullMQ job state on MultiTagRecovery rehydration` | Root cause — recover original results instead of resubmitting at restart; symmetric `saveAssistantMessage` try/catch                       |
| #1064 | `fix(bot-client): resolve real persona UUID at MultiTagRecovery time`    | FK violation closed — `PersonaResolver` cascade replaces synthetic `recovery-persona-*` strings; conversation history persists correctly   |
| #1065 | `fix(bot-client): close 4 MultiTagRecovery follow-ups from #1063/#1064`  | Defense-in-depth + perf — returnvalue shape guard, per-delivery try/catch, `Promise.all` parallelize, `resolvePersonaIdOnly` cheaper query |
| #1066 | `fix(bot-client): route multi-tag live-failure events via coordinator`   | Live failure routing — `JobFailureListener` now synthesizes failure + calls `handleJobResult` for multi-tag jobIds (no more 10-min wait)   |

### Net result

The multi-tag fan-out path is substantially more resilient:

- **Restart recovery**: original responses preserved (no resubmission); per-slot latency roughly halved via `Promise.all`
- **Live failures**: routed to user within seconds, not 10 minutes (synthesized failure result via coordinator path)
- **Conversation history**: persists correctly for recovered messages (real persona UUID instead of synthetic FK violation)
- **Defense-in-depth**: returnvalue shape validation, per-delivery error handling, belt-and-suspenders `saveAssistantMessage` try/catch

### Backlog deltas

- `inbox.md` cleared (live-failure listener shipped via #1066)
- `current-focus.md` cleared (rehydration follow-up chain fully shipped)
- `deferred.md`: 2 trigger-gated items remain from the chain (idempotent re-dispatch, synthesized-failure `personalityErrorMessage`)
- Three memory updates: temporal-marker patterns extended (`extracted from X`, `This is the primary fix`), Steam Deck pre-push flake reference added

### Backlog state at session close

- **Production issues**: 0 active
- **Inbox**: empty
- **Current focus**: empty (open-pick next session)
- **Quick wins**: 1 active (`/admin metrics`)
- **Active epic**: none
- **Deferred**: 89 trigger-gated items (+2 from this chain)
- **Future themes**: 23 queued

---

## Prior Session — v3.0.0-beta.123 release + PR #1062 fast-follow + backlog cleanup (2026-05-18 → 2026-05-19)

Marathon sweep cycle: started with intake from a personal-notes review of recent UX issues, shipped 10 PRs into the beta.123 release, then a post-release fast-follow PR and a backlog hygiene pass.

### PRs merged this cycle

| PR    | Title                                                                          | Domain                    |
| ----- | ------------------------------------------------------------------------------ | ------------------------- |
| #1051 | `chore(api-gateway): /metrics housekeeping`                                    | Internal API auth         |
| #1052 | `fix(ai-worker): bound voice-engine STT retry loop`                            | Voice STT                 |
| #1053 | `fix(bot-client): unblock channel queue when AI job fails`                     | Multi-personality routing |
| #1054 | `chore(deps): bump production-dependencies` (×7)                               | Deps                      |
| #1055 | `chore(deps-dev): bump development-dependencies` (×14) + knip 6.14.1 fallout   | Deps + ci hook            |
| #1056 | `fix: cross-channel history ordering + voice transcript tagging`               | Conversation context      |
| #1057 | `fix(ai-worker): cache header-less 429s + bump free gemma constant`            | LLM provider              |
| #1058 | `fix(bot-client): activation slot on forwarded messages`                       | Discord routing           |
| #1059 | `chore(bot-client): polish /admin db-sync embed truncation`                    | Admin UX                  |
| #1060 | `v3.0.0-beta.123` (release PR, develop → main)                                 | Release                   |
| #1062 | `fix(bot-client): render personality voice on multi-tag safety-timeout errors` | Post-release follow-up    |

Plus PR #1049 (per-result `deliverFn` for multi-personality race) which landed on develop earlier and shipped in this release.

### Post-release: production failure surfaced + diagnosed + partial-fix shipped

Within minutes of beta.123 deploy, a user-visible error appeared in Discord ("Sorry, I encountered an error..."). Railway logs revealed the failure mode:

- Old bot-client SIGTERM'd cleanly at 05:16:15 UTC
- Old ai-worker completed the in-flight job 17s LATER (05:16:32 UTC) — result published to BullMQ with no consumer listening
- New bot-client rehydrated coordinator entry but `QueueEvents` is a stream subscription that doesn't replay events emitted before the listener attached
- 10 min later `MultiTagCoordinator.handleSafetyTimeout` fired → generic bot error in Discord

**PR #1062** addresses the user-facing symptom (in-character voice on safety-timeout instead of generic bot fallback). **The structural fix** (poll BullMQ job state at rehydration to backfill missed completion events) is now the next-session active focus, since it's reproducible on every deploy with in-flight jobs.

### Backlog hygiene pass

- **production-issues.md**: ping-race entry retired (shipped in PR #1049). No active production issues.
- **active-epic.md**: TTS Engine Upgrade closed — Phase 1 + Phase 3 shipped, Phase 2 abandoned with replacement work tracked in the "Self-Hosted TTS + BYOK Re-Evaluation" theme. File stripped to a closure stub.
- **API Security Hardening theme**: items 1 (rate limiter, PR #1046) + 2 (helmet/CORS, PR #1046/#1048) already shipped; theme retitled to reflect that only the voice-reference slug-enumeration item remains.
- **deferred.md**: +1 entry (personality-voice for completed-but-empty slots, from PR #1062 round-3 review).

### Backlog state at session close

- **Production issues**: 0 active
- **Inbox**: empty (last swept 2026-05-19)
- **Current focus**: 1 active (rehydration poll)
- **Quick wins**: 2 items (`/admin metrics`, retry-on-inadequate-LLM-response)
- **Active epic**: none — pick from next-theme candidates
- **Deferred**: 87 trigger-gated items
- **Future themes**: 23 queued

---

## Migrations Applied (v3.0.0-beta.120)

All three migration waves were applied to dev + prod during the previous development cycle:

- `add_stt_provider_columns` (#1005, additive)
- `drop_unused_voice_provider_columns` (#1007)
- `add_stt_provider_check_constraint` (#1008)

No new migrations in v3.0.0-beta.121, beta.122, beta.123, or develop since.
