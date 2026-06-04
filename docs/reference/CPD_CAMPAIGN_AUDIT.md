# CPD Reduction Campaign — Close-Out Audit

**Date**: 2026-05-16
**Result**: Campaign closed with `109 / 1752` filtered duplication at `minLines: 10` (down from raw `113 / 1684` jscpd output, post-filter excludes 4 call-dominant fragments).

This document is a one-time snapshot of the campaign's end-state. Future contributors checking `pnpm ops cpd:filtered` should expect numbers near these and consult this audit for the rationale on each remaining clone pair.

## Why the raw jscpd count won't go lower

After three rounds of helper extraction (PRs #1039, #1040, #1041), the bulk of remaining "duplication" reported by jscpd is **structural skeleton-shape similarity** between sibling files that share an architectural pattern. jscpd's token-stream matcher can't distinguish "two files using the same shared helper at the same step in their handler" from "two files with copy-pasted logic" — both look identical at the token level.

Three independent council models (Gemini 3.1 Pro Preview, Kimi K2.6, GLM 5.1) reviewed the campaign and converged on this verdict. Forcing the raw count lower would require either:

- **Wrong Abstraction**: extracting a route-handler factory that takes 4+ callback parameters to handle real divergences between LLM/TTS/admin/user variants. All three reviewers flagged this trap.
- **Cosmetic gymnastics**: `jscpd:ignore` markers around legitimate code, or artificial variable renames to break token matches. Makes the code worse.

The post-filter (`pnpm ops cpd:filtered`) computes a more honest **filtered count** that excludes fragments where ≥80% of classifiable lines are call-expression shape — i.e., obvious helper-call uniformity. The filtered metric drives the CI ratchet; the raw jscpd count remains informational.

## Audit results: the 25 largest remaining clone pairs

Categories (per GLM's audit framework):

- **🟢 Campaign-resolved (accepted structural-uniformity)** — sibling files share helper-using skeleton shape. State 3 — helpers in place with documented boundary. Forcing further extraction = Wrong Abstraction.
- **🟡 Out-of-scope (different domain, deferred)** — override files, bot-client commands, ai-worker services. These belong to separate future campaigns, not this one.
- **🔵 In-file duplication** — same file references itself. Often loops or repeated guards within one handler. Usually fixable by extracting a local helper but the call sites stay in the same file.
- **🟣 Worth looking at later** — sibling service implementations (`LlmConfigService` ↔ `TtsConfigService`) and parallel utilities. Future campaign target, not this one.

| Pair                                                                                  | Lines | Clones | Category             | Notes                                                                                                                                     |
| ------------------------------------------------------------------------------------- | ----- | ------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `bot-client/commands/character/overrides.ts` ↔ `character/settings.ts`                | 93    | 4      | 🟡 Out-of-scope      | Different campaign (bot-client commands, not api-gateway CRUD).                                                                           |
| `bot-client/commands/character/truncationWarning.ts` ↔ `persona/truncationWarning.ts` | 88    | 3      | 🟡 Out-of-scope      | Parallel warning-handler files; bot-client domain.                                                                                        |
| `api-gateway/routes/admin/llm-config.ts` ↔ `admin/tts-config.ts`                      | 82    | 5      | 🟢 Campaign-resolved | Handler-body skeletons using extracted helpers. Wrong Abstraction to force further extraction.                                            |
| `api-gateway/routes/user/history.ts` (self)                                           | 53    | 3      | 🔵 In-file           | Internal duplication in a single file. Local-helper extract opportunity if revisited; out of campaign scope.                              |
| `api-gateway/routes/user/memorySingle.ts` (self)                                      | 52    | 3      | 🔵 In-file           | Same shape as above.                                                                                                                      |
| `api-gateway/routes/user/model-override.ts` ↔ `tts-override.ts`                       | 49    | 4      | 🟡 Out-of-scope      | Cascade-override semantics — different domain than CRUD. Forcing CRUD helpers here is the Wrong Abstraction trap per Kimi K2.6 / GLM 5.1. |
| `api-gateway/routes/user/llm-config.ts` ↔ `user/tts-config.ts`                        | 45    | 3      | 🟢 Campaign-resolved | Update-handler body shape; PR #1041 extracted collision flow; remaining is skeleton structure.                                            |
| `bot-client/utils/dashboard/settings/SettingsDashboardHandler.ts` (self)              | 41    | 2      | 🔵 In-file           | bot-client dashboard; separate campaign.                                                                                                  |
| `bot-client/commands/settings/preset/autocomplete.ts` ↔ `voice/tts/autocomplete.ts`   | 38    | 2      | 🟡 Out-of-scope      | Autocomplete-handler pattern duplication; bot-client domain.                                                                              |
| `bot-client/commands/memory/incognito.ts` (self)                                      | 36    | 2      | 🔵 In-file           | bot-client memory commands.                                                                                                               |
| `ai-worker/services/voice/ElevenLabsVoiceService.ts` ↔ `MistralTtsProvider.ts`        | 34    | 2      | 🟣 Worth-later       | Parallel voice-provider implementations. Future "voice provider abstraction" campaign target.                                             |
| `bot-client/commands/deny/index.ts` (self)                                            | 33    | 1      | 🔵 In-file           | bot-client commands.                                                                                                                      |
| `api-gateway/routes/admin/llm-config.ts` ↔ `user/llm-config.ts`                       | 32    | 2      | 🟢 Campaign-resolved | Admin-vs-user parallel for same resource; pre-existing architecture.                                                                      |
| `ai-worker/services/voice/ElevenLabsClient.ts` (self)                                 | 31    | 2      | 🔵 In-file           | ai-worker client; different campaign.                                                                                                     |
| `api-gateway/routes/user/memoryBatch.ts` (self)                                       | 28    | 2      | 🔵 In-file           | Batch handler patterns.                                                                                                                   |
| `bot-client/commands/preset/autocomplete.ts` ↔ `voice/tts/autocomplete.ts`            | 27    | 1      | 🟡 Out-of-scope      | Same autocomplete cluster as above.                                                                                                       |
| `ai-worker/services/KeyValidationService.ts` (self)                                   | 27    | 2      | 🔵 In-file           | ai-worker service.                                                                                                                        |
| `bot-client/utils/subcommandContextRouter.ts` ↔ `subcommandRouter.ts`                 | 26    | 1      | 🟣 Worth-later       | Two router utilities that may want consolidation; bot-client architecture.                                                                |
| `packages/tooling/utils/env-runner.ts` (self)                                         | 25    | 1      | 🔵 In-file           | Tooling utility.                                                                                                                          |
| `api-gateway/routes/user/shapes/export.ts` ↔ `shapes/import.ts`                       | 24    | 2      | 🟡 Out-of-scope      | Different domain (Shapes import/export flow).                                                                                             |
| `api-gateway/routes/user/voices.ts` (self)                                            | 24    | 1      | 🔵 In-file           | Voice routes.                                                                                                                             |
| `api-gateway/services/LlmConfigService.ts` ↔ `TtsConfigService.ts`                    | 24    | 2      | 🟣 Worth-later       | Parallel service implementations. Future "service helpers" campaign target (sibling to this one but at the service layer).                |
| `api-gateway/routes/user/config-overrides.ts` (self)                                  | 23    | 2      | 🔵 In-file           | Override route internals.                                                                                                                 |
| `bot-client/commands/persona/browse.ts` ↔ `preset/browse.ts`                          | 22    | 1      | 🟡 Out-of-scope      | bot-client browse pattern.                                                                                                                |
| `api-gateway/utils/apiKeyValidation/mistral.ts` ↔ `zaiCoding.ts`                      | 22    | 1      | 🟣 Worth-later       | Parallel API-key validators. Could share a small abstraction.                                                                             |

## Category totals (filtered set)

| Category                           | Pairs                 | Lines      | Clones |
| ---------------------------------- | --------------------- | ---------- | ------ |
| 🟢 Campaign-resolved               | 3                     | 159        | 10     |
| 🟡 Out-of-scope (different domain) | 7                     | 332        | 16     |
| 🔵 In-file duplication             | 10                    | 339        | 19     |
| 🟣 Worth-later (parallel siblings) | 4                     | 116        | 7      |
| **Top 25 covered**                 | **24**                | **946**    | **52** |
| (Long tail not enumerated)         | ~85 pairs / 57 clones | ~806 lines | —      |

Note: filtered-line sums in the right columns represent the post-filter "expanded" count (sum of `.lines` per clone, with overlap counted multiply). This differs from jscpd's deduplicated `duplicatedLines` stat by ~70 lines, but is the metric the ratchet uses for consistency.

## Decision: ratchet baseline

The CI ratchet baseline is set to the **current filtered line count (1752) + grace margin (10)** = **1762**. The grace margin is intentionally tiny — large enough to absorb a single ~10-line skeleton clone added during routine work, small enough to catch any meaningful regression. It explicitly does NOT absorb a hypothetical TTS-style epic regressing 469 lines like the original problem.

Adjusting the threshold (`pnpm ops cpd:filtered --threshold 0.5`) reveals that lowering the call-ratio bar surfaces more excludable clones but also starts catching legitimate logic. **0.8 is the right setting** — it accepts the "skeleton duplication is real" finding rather than papering over it.

## What this audit explicitly accepts as future work

These are not deferred bugs — they are **legitimate future campaigns** that should each get their own deliberation:

1. **bot-client command-pattern campaign** — `commands/character/*`, `commands/persona/*`, `commands/preset/*`, `commands/memory/*`, autocomplete files. The bot-client follows Discord.js command conventions that produce different shape duplication than api-gateway CRUD. Would need its own helper layer.
2. **ai-worker service-pattern campaign** — voice providers, key validators, AI client wrappers. Service-layer parallels.
3. **api-gateway override-route campaign** — the cascade-override domain. Explicitly out-of-scope per Kimi K2.6 / GLM 5.1 — different shape than CRUD; needs its own design.
4. **In-file local-helper extraction** — many handlers have repeated guards or loops within themselves. Local-helper extraction is per-file work; not a campaign-shape problem.
5. **Service-layer parallel cleanup** — `LlmConfigService` ↔ `TtsConfigService`, `apiKeyValidation/{mistral,zaiCoding}`. Sibling implementations that may want a thin abstraction layer.

Each of these would benefit from its own council pass before committing to a direction.

## What's enforced going forward

- `pnpm cpd` continues to produce raw jscpd output (informational)
- `pnpm ops cpd:filtered` shows the metric that matters (call-dominant fragments excluded)
- `pnpm ops cpd:check` (run in CI) fails the build if filtered lines exceed `cpd-baseline.json`'s ceiling
- `.claude/rules/02-code-standards.md` documents:
  - The helpers in `configRouteHelpers.ts` and their applicable shape
  - The 2-callback ceiling rule for considering future extractions
  - The "cascade-override is Wrong Abstraction territory" boundary
- Future contributors who see jscpd flagging a clone first ask: is this a new call-site of a shared helper (likely OK, may be excluded by filter) or a new copy-paste of logic (real debt, fix it)?

## Campaign close-out summary

**Three goals from the campaign brief:**

| Goal                            | Status                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1. Code quality improves        | ✅ Helpers extracted, type safety preserved, behavior unchanged across 144 route tests                      |
| 2. DRY violations resolved      | ✅ Genuine copy-paste eliminated; remaining clones are structural-skeleton, in-file, or out-of-scope domain |
| 3. Viable enforcement mechanism | ✅ Post-filter + differential CI ratchet + documented boundary in `.claude/rules/`                          |

The campaign closes here. Future contributors continuing this work should start with one of the deferred campaigns above, with a fresh council pass.

## Post-campaign calibration confirmation (2026-06-03)

The `graceMargin: 10` value in `.github/baselines/cpd-baseline.json` was provisionally set at close-out with an open question: would 10 lines survive routine feature PRs without false-positive blocks? **Answer: yes.** Across the ~60 PRs merged between 2026-05-16 and 2026-06-03 (the typed-client epic PRs #1087–#1116, the `@tzurot/clients` extraction, common-types slimming Phase 1, the beta.126/127 release cycles, and the 2026-06-03 quick-wins sweep), `cpd:check` never tripped on legitimate code. The value is considered calibrated and locked in; raise it only with a concrete false-positive in hand, per the ratchet rules in `.claude/rules/02-code-standards.md`.
