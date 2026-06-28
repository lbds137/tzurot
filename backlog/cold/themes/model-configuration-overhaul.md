### Theme: Model Configuration Overhaul

_Redesign how models are configured. Bundle paid/free/vision into reusable profiles._

#### ✨ Vision model as a first-class config — decouple from LlmConfig (user direction 2026-06-16)

**Motivation (prod, 2026-06-16):** an image in an activated channel "didn't come through" because the personality's configured vision model (`qwen/qwen3.5-397b-a17b`, a 397B MoE) consistently exceeded the 90s vision budget and aborted → no description → the LLM improvised "image didn't come through." Diagnosed from prod ai-worker logs; the slug is valid + vision-capable, just too slow. Infra behaved correctly (retry + transient-timeout negative cache + graceful degrade). The manual fix today: change that personality's vision model to a faster one (e.g. `qwen/qwen3-vl-30b-a3b-instruct`).

**Near-term want — auto-fallback on vision failure:** when the configured vision model times out/errors, automatically try a different (faster/known-good) vision model instead of degrading to no-image. The user explicitly wants this — but "we'd need to do some cleanup to make it viable" because the vision model is currently glued to `LlmConfig` (no independent vision-model choice or fallback chain).

**Architectural goal (the cleanup):** make the vision model a **top-level, first-class config that parallels text models** — its own config/preset with **global default, free default, and per-user override via slash command**, exactly like the text-LLM-config surface. Vision selection should NOT be a field bolted onto `LlmConfig`; it's its own axis.

**Design RESOLVED (user, 2026-06-26) → separate parallel vision axis. Phase 1 ✅ SHIPPED (PR #1364).** The "bundle vision INTO a profile" shape (LLM Config Profiles sub-theme below) was rejected in favor of a **separate vision config that REUSES the `LlmConfig` table via a `kind: 'text' | 'vision'` discriminator** — vision presets are `kind='vision'` rows whose `model` IS the vision model, with their own global-paid + free defaults + cascade, edited via the SAME machinery as text. `visionModel` is removed from `LlmConfig`; `personality.visionModel` stays as the in-memory carrier, now filled gateway-side by a `VisionConfigResolver` (mirrors `TtsConfigResolver`). **Phase 1 (foundation) ✅ SHIPPED** (PR #1364, merged 2026-06-27; migration applied to dev — release pending): schema migration (kind + per-kind partial-unique default indexes + vision FK/join columns), `VisionConfigResolver` + gateway stamping, surface amputation, per-kind default/list/name-check scoping in `LlmConfigService`, `VisionConfigBootstrap` seed. Phase 1 leaves vision seed/DB-only (no editing UI). Review round-2 nits (kind type-tighten, requireKind leniency, setAsDefault null-path, warn/comment polish) deferred to a cleanup follow-up in `cold/follow-ups.md`. Editing surface = Phase 2 (below); auto-fallback (the near-term want above) = Phase 3.

**Fold-in — negative-cache key should include the resolved vision model:** `VisionDescriptionCache` keys failures by Discord attachment id / URL-hash only (`services/ai-worker/src/services/VisionDescriptionCache.ts`), NOT by model — so when a vision model is too slow and an image times out (negative-cached 10 min via the generic `VISION_FAILURE_TTL`), switching the configured vision model does NOT invalidate that image's cached failure; the same attachment replays the cached failure until the cooldown expires. Today that's a deliberate anti-re-hammer design and only bites during testing (re-upload the image = new attachment id = fresh attempt). Once vision becomes a first-class config (and especially with auto-fallback), the negative-cache key should incorporate the resolved vision model so a model swap / fallback re-attempts immediately instead of waiting out the cooldown. Surfaced 2026-06-16 during beta.133 dev-smoke vision-timeout.

#### ✨ Editing surface + capability filtering (Phase 2) — council-reshaped 2026-06-28

After Phase 1 the vision (and future-modality) config is seed/DB-only. Phase 2 makes it editable, REUSING the kind-aware service layer Phase 1 built. A 3-model council (GLM-5.2 / Kimi-K2.7 / Qwen-3.7-max, 2026-06-28) reshaped the work into slices and locked the key design calls.

**Slices (each = one PR):**

- **S0 — resolver kind-scoping bug fix (✅ shipping, PR #1374).** `LlmConfigResolver.getFreeDefaultConfig()` had no `kind` filter, so a free-tier TEXT resolution could return the seeded `kind='vision'` free-default (`findFirst`, no `orderBy` → nondeterministic). Fixed with `kind:'text'`. Audit confirmed it was the ONLY leak (`VisionConfigResolver` scopes correctly; `TtsConfigResolver` is a separate table; the other text tiers join via the text-specific FK columns `defaultLlmConfigId`/`llmConfigId`). Shipped standalone because it's a latent prod bug (armed in every env where Phase 1 deployed).
- **S1 — kind-aware backend (✅ shipped, PR #1376).** Parametrized the hardcoded `kind:'text'` filters in `LlmConfigService` (`list`, `checkNameExists`, `resolveNonCollidingName`, `create`) by a requested kind; added optional `kind` to the create Zod schema (defaults text) + omitted it from update (**immutable** — mutable kind orphans the per-kind default flags); `getById` gained an `expectedKind` **post-fetch** gate (kept `findUnique` — no `findFirst`-churn — closing the read half of #4 at the service level); `kind` projected in DETAIL_SELECT for the gate (formatters omit it). Extracted the clone-name walk to `llmConfigNameCollision.ts`. No vision exposure yet — routes stay text via defaults.
- **S1b — capability validation (✅ SHIPPED, PR #1377).** `ModelCapabilityService` over a **unified, provider-agnostic `ModelCapabilities` shape** (`{supports{Vision,ImageGeneration,AudioInput,AudioOutput}, contextLength, source}`) in common-types — the first concrete step of provider-decoupling (see `cold/ideas.md`). Resolution priority **OpenRouter authoritative → z.ai catalog → null**; `resolve(modelId)` takes ONLY the model id (capabilities are a property of the model, not the user — the planned `hasZaiCodingKey` param was dropped as a dead arg; the z.ai-key/access concern stays in the context validator). z.ai catalog (`ZaiCodingPlanModelInfo`) gained optional modality flags (omitted = text-only; all 6 current models stay text-only) + a `zaiCodingPlanModelCapabilities()` mapper. `validateLlmConfigModelFields` gained a **fail-closed vision gate** (kind from `body.kind` on create, derived from the immutable row on update; fires only when a model is being SET, so a context-only edit doesn't re-validate an unchanged model). Create-path name-collision is now kind-scoped (`ensureNoNameCollision` forwards `kind` → `checkNameExists`). **Route-layer kind threading was DEFERRED to S2** (below): it's dormant until a command sends `kind=vision`, so it lands + is end-to-end tested with its consumer. The seeded vision defaults bypass route validation, so they're unaffected.
- **S2 — route kind-threading + commands (NEXT).** **First, the deferred S1b route wiring** (the #1376/#1377 reviews flagged it as REQUIRED before any vision route goes live): thread the request kind into `list` / `getById` (via a `?kind=` query param, default text, 400 on invalid) + `requireKind` on set-default / free-default / delete / update + `ensureNoNameCollision` on the **update/rename** path (create already threads it — without this, renaming a vision config collides against text-kind names). Fold in the three #1377-review S2 notes: (a) the **`getById` double-trip** on model-update — pass the route's already-fetched row kind into `validateLlmConfigModelFields` so the update path doesn't fetch twice; (b) the **`NameExistsChecker` options-object** refactor if the 5-param signature grows; (c) a **null-config fallback comment** in `resolveEffectiveModelAndKind` (when `getById` returns null on update, kind stays text → gate skipped → the route's own fetch 404s; behavior is correct, just worth documenting). **Then the commands:** `kind` choice option (`text | vision`, default `text`) on the four default-setters (`/preset global default|free-default`, `/settings preset set-default|set`) + `/preset create` (the `kind` must survive the modal round-trip via the custom-ID prefix); autocomplete reads `kind` and filters via `/api/internal/models`; **vision-aware WRITE paths** (set-default / set-override write the vision FK columns — `defaultVisionConfigId` / `visionConfigId` — when kind=vision). Modal model entry is plain text (no autocomplete inside modals), so S1b's save-time capability validation is the safety net for modal-created configs.
- **S3 — admin dashboard: DEFERRED** (to a later phase / a web UI). Council-unanimous: Discord modals are text-only and select menus cap at 25, so a model-PICKER dashboard fights the platform — model selection stays in the autocomplete-backed slash commands. A preset-SELECTION dashboard (pick among existing configs to set a default; pairs with the settings-dashboard pagination idea in `cold/ideas.md`) is feasible later but isn't worth Phase 2.

**Already done in Phase 1 (NOT Phase 2 work):** `CONFIG_KINDS` / `ConfigKind` / `DEFAULT_CONFIG_KIND` + `toConfigKind()` in common-types; per-kind `setAsDefault` / `setAsFreeDefault`; the kind-scoped partial-unique default indexes (`UNIQUE (kind) WHERE is_default`/`is_free_default`, `UNIQUE (kind, name) WHERE is_global`).

**Future modalities** (image/video): new `kind` value + a new `XConfigResolver` subclass + a `CAPABILITY_BY_KIND` entry — no new commands, no new tables. Use `CONFIG_KINDS` + a capability-by-kind map instead of `if (kind==='vision')` branches; don't build a heavy base abstraction until 3+ modalities exist (council: resist premature generalization). Caveat: image/video GENERATION are output models — the config cascade is identical, but downstream consumption is per-capability.

#### ✨ Config cascade extension — server, user-server, user-channel tiers

Current cascade: admin < personality < channel < user-default < user+personality. Missing tiers:

- **Server-level defaults** (server admins can set channel-scoped-to-guild defaults)
- **User-channel** (per-user per-channel, e.g., "1 week maxAge globally but off in #general")

User-default overriding channel is by design but limits power-user flexibility. Significant refactor — likely bundled with LLM Config Profiles since both change cascade shape.

#### ✨ LLM Config Profiles (Meta Configs)

Current LlmConfig is a single model. Redesign as **profiles** that bundle paid + free models together, so the system can auto-fallback and users pick a profile rather than individual models.

**Core concept**: A profile is a named container with a description/purpose (e.g., "General Purpose", "NSFW", "Coding") that holds:

- Paid model config (model, temperature, max tokens, etc.)
- Free model config (fallback when quota/billing isn't available)
- Vision model config (bundled in — changing the global vision model should be one action, not per-LlmConfig)

**Cascade integration**: Profiles apply at all 4 config cascade levels — admin global default, personality default, user global default, user-personality override. Vision model inherits from the profile by default but users can override at any tier.

**User-facing**:

- Admin creates global profiles (themed defaults everyone can use)
- Users can create their own profiles (global/non-global, like personalities)
- `/preset` system may merge into or coexist with this

**Open questions**:

- Relationship to existing `Preset` system — replace, merge, or layer on top?
- How many vision profile themes are actually needed? (general, NSFW, document — or just general + NSFW)
- Character-level free model default (does it exist today? needs investigation)

#### ✨ Free Model Quota Resilience

Automatic fallback to alternative free model on 402 quota errors. Track quota hits per model to avoid repeated failures. Foundation shipped in PR #587.

#### 🏗️ Vision Model as Full LLM Config

Currently vision model is just a model name string. Promote to a full `LlmConfig` reference (temperature, max tokens, system prompt, etc.) — but exclude the `visionModel` field itself (no recursive vision config). Likely folded into profiles above.
