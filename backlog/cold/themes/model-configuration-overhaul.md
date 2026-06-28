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
- **S1b — capability validation + route wiring (NEXT).** Build a **`ModelCapabilityService`** over a **unified, provider-agnostic capability shape** (the first concrete step of provider-decoupling — see the OpenRouter-decoupling idea in `cold/ideas.md`). Capability source priority (user direction 2026-06-28): **OpenRouter is authoritative** — if the model exists there, use its capability tags. **z.ai-only models default to text-only** (the z.ai coding-plan catalog has no vision today — GLM 5V Turbo isn't on the coding plan; GLM 5.2 is GA on OpenRouter) unless we enrich the z.ai constants (`ZAI_MODEL_CATALOG`, currently `{docsUrl, contextLength, released?}`) with explicit modality/kind info. Validate at create AND update: **vision = fail-closed** (model can't be confirmed vision-capable → reject), text does NOT reject vision models (they're text-capable), requirement **derived from the row's `kind`** (not a caller flag — callers can lie; the row can't). PLUS **route-layer kind threading** — thread the request's kind into `requireKind` / `checkNameExists` / `list` / `getById` (the service already accepts it from S1). REQUIRED before any vision route goes live (#1376 review); until then the text-only invariant holds (vision is seed/DB-only).
- **S2 — commands.** Add a `kind` choice option (`text | vision`, default `text`) to the four default-setters (`/preset global default|free-default`, `/settings preset set-default|set`) + `/preset create` (the `kind` must survive the modal round-trip via the custom-ID prefix); autocomplete reads `kind` and filters via `/api/internal/models`; **vision-aware WRITE paths** (set-default / set-override write the vision FK columns — `defaultVisionConfigId` / `visionConfigId` — when kind=vision). Modal model entry is plain text (no autocomplete inside modals), so S1b's save-time capability validation is the safety net for modal-created configs.
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
