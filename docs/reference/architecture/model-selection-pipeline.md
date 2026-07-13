# Model-Selection Pipeline

How Tzurot decides **which model** (and which key/provider) serves a request — for text
generation and for vision (image description). This is the reference for the two
independent cascades and the two-phase resolve-then-execute split they run through.

> **Status (2026-07-01):** the text + vision resolution cascades and the gateway-stamped
> vision fallback chain are shipped (Model Config Overhaul epic, Phase 4 slices A/B/C1).
> The **runtime vision fallback loop** (retry-down-the-chain on failure) is _designed but
> not yet wired_ — see [§Vision fallback loop](#vision-fallback-loop-designed--pending). Its
> plumbing (`visionFallbackModels` on the envelope, model-parameterized `resolveVisionAuth`)
> is in place; the loop that consumes them is the pending C2b slice.

## The two-phase split (load-bearing)

```
bot-client ──▶ api-gateway ─────────────▶ ai-worker
             (RESOLVE which config)     (EXECUTE: auth, model call, vision)
```

- **api-gateway resolves** which config a request uses — it has Prisma + the user/personality
  rows + `AdminSettings`, but **no API keys and no live model-capability data**. It stamps the
  resolved model(s) onto the job envelope.
- **ai-worker executes** — it has the API keys, the OpenRouter capability cache, and the
  runtime failure signals, but **no user-preference DB**. It performs key resolution, the
  guest downgrade, and the actual model invocation.

This boundary is **deliberate and load-bearing** (confirmed by a 3-model council pass,
2026-07-01). Do not try to "unify into one cascade": the gateway can't resolve keys and the
worker can't resolve user preferences without re-querying. The correct shape is **one explicit
ordering per axis**, with each service owning its half — the worker receives what it can't
compute (the resolved models + the stamped fallback chain) via the envelope.

## Text LLM config cascade

Resolves `personality.model`. First match wins:

| #   | Tier                           | Field / pointer                                                               | Where                                               |
| --- | ------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | User per-personality override  | `UserPersonalityConfig.llmConfigId`                                           | gateway — `LlmConfigResolver` (config-resolver pkg) |
| 2   | User global default            | `User.defaultLlmConfigId`                                                     | gateway — `LlmConfigResolver`                       |
| 3   | Personality seed               | the personality's own `model`                                                 | baked into `LoadedPersonality`                      |
| 3b  | → falls back to global default | `AdminSettings.globalDefaultLlmConfigId`                                      | gateway — `PersonalityLoader` (identity pkg)        |
| 4   | Guest/free downgrade           | `AdminSettings.freeDefaultLlmConfigId` → hardcoded `GUEST_MODE.DEFAULT_MODEL` | **worker** — `AuthStep.applyGuestModeOverrides`     |

Tiers 1–3b resolve gateway-side (`LlmConfigResolver.resolveConfig`, stamped by
`stampResolvedConfig` in `jobChainOrchestrator`). Tier 4 is a **worker-side constraint**, not a
preference: when key resolution falls to the system key (`isGuestMode`), the worker overrides a
paid model to the free default. Guest-downgrade is _last_ because "no key ⇒ can't use paid
models" is a constraint applied on top of the resolved preference, not a preference tier.

## Vision config cascade

Vision configs are `kind='vision'` rows in the same `llm_configs` table; their `model` field
_is_ the vision model. Resolved by `VisionConfigResolver` (a `BaseConfigResolver` subclass),
independent of the text cascade. First match wins:

| #   | Tier                                 | Field / pointer                               | Where                                        |
| --- | ------------------------------------ | --------------------------------------------- | -------------------------------------------- |
| 1   | User per-personality vision override | `UserPersonalityConfig.visionConfigId`        | gateway                                      |
| 2   | User global vision default           | `User.defaultVisionConfigId`                  | gateway                                      |
| 3   | Personality vision default           | `PersonalityVisionDefaultConfig` (join table) | gateway                                      |
| 4   | Global vision default                | `AdminSettings.globalDefaultVisionConfigId`   | gateway                                      |
| 5   | Hardcoded fallback                   | `MODEL_DEFAULTS.VISION_FALLBACK`              | gateway (skipped from the stamp — see below) |

The resolved vision model is stamped onto `personality.visionModel`. The `hardcoded` tier is
**not** stamped, so the worker's `selectVisionModel` can still prefer the main model's native
vision (priority 2) during the bootstrap window before vision globals are seeded.

**The main model's native vision** (priority 2 of `selectVisionModel`) lives in the worker, not
the resolver — it needs the live OpenRouter capability check (`hasVisionSupport`). So the
effective worker-side priority is: stamped `visionModel` (tier 1) → main-model-if-native-vision →
the runtime floor settings (`fallbackVisionModelFree` for guests / `fallbackVisionModel` for
BYOK — editable via /admin settings, resolved through the system-settings SWR cache).

## The four AdminSettings default pointers

`AdminSettings` carries four nullable FK pointers (`onDelete: SetNull`). Read-status matters:

| Pointer                       | Read by a resolver?                  | Where                                             |
| ----------------------------- | ------------------------------------ | ------------------------------------------------- |
| `globalDefaultVisionConfigId` | ✅ yes                               | `VisionConfigResolver` tier 4                     |
| `freeDefaultLlmConfigId`      | ✅ yes                               | `AuthStep` guest-downgrade                        |
| `globalDefaultLlmConfigId`    | ✅ yes (seed layer, not the cascade) | `PersonalityLoader.loadGlobalDefaultConfig`       |
| `freeDefaultVisionConfigId`   | ✅ yes (as of Slice A)               | `VisionConfigResolver.getFreeDefaultVisionConfig` |

`freeDefaultVisionConfigId` was **write-only** (settable in the admin UI, read by nothing) until
Phase 4 Slice A added the reader. It stamps into the vision fallback chain (below).

## Guest / free downgrade

Split across three places by design, each owning the part it can see:

1. `ApiKeyResolver` decides `isGuestMode` (it fell to the system key).
2. `AuthStep.applyGuestModeOverrides` handles the **text** downgrade (→ `freeDefaultLlmConfigId`
   or the hardcoded guest model).
3. `resolveVisionConfig` / `resolveBroadFreeFallback` handle the **vision** downgrade: an
   authenticated user with no key for the vision provider downgrades to the free vision model on
   the **system** OpenRouter key (gated by `VisionFallbackQuota`, a per-user daily cap, fail-open).

## Vision failure handling + negative cache

`describeImage` invokes one vision model. On failure, `invokeVisionModel` classifies the error
into an `ApiErrorCategory`, stores it in the **negative cache** (`VisionDescriptionCache`, keyed
by `(model, attachmentId|urlHash)` with per-category TTL), and surfaces a human-readable
`[Image unavailable: …]` placeholder (the LLM reads it as attachment-description content).

Because the negative cache is keyed **by model**, swapping the model (a global-default change, or
the fallback loop below) re-attempts immediately rather than replaying the old model's failure.

## Vision fallback loop (designed — pending)

> Phase 4's headline behavior. **Not yet wired** — the plumbing is in place, the loop is the
> pending C2b slice. Documented here so the design is the reference when it lands.

Today a vision failure yields one `[Image unavailable: …]` placeholder immediately. The fallback
loop retries **down the chain** on a _retryable_ failure before giving up:

**Tier list** (deduped by model, capped at `MAX_VISION_FALLBACK_TIERS = 3`, negative-cached tiers
skipped): resolved primary → main-model-native-vision (worker-local) → `globalDefaultVisionConfigId`
→ `freeDefaultVisionConfigId` → hardcoded floor. The two DB tiers are **stamped gateway-side** onto
`personality.visionFallbackModels` (Slice B) — the worker has no Prisma, so all DB resolution stays
on the gateway; the worker composes its local tiers around the stamped list.

**Retry-vs-terminate policy** — `VISION_TERMINATE_CATEGORIES = { CONTENT_POLICY, CENSORED,
MEDIA_NOT_FOUND }` terminate the loop immediately (the _image itself_ is rejected — another model
won't help). This is a **strict subset** of `ATTACHMENT_BOUND_FAILURE_CATEGORIES`, excluding
`MODEL_NOT_FOUND` — a missing model is exactly what a fallback tier routes around, so it retries.
Everything else (AUTH, RATE_LIMIT, QUOTA, SERVER, NETWORK, TIMEOUT, MODEL_NOT_FOUND) advances to
the next tier.

**Per-tier auth** — each fallback model may need a different provider/key, so the loop resolves
auth per tier via `resolveVisionAuth(targetModel, options, quotaTracker)` (model-parameterized,
Slice C1). The system-key free-tier daily quota is consumed **at most once per request** via a
request-scoped `createVisionQuotaTracker`, never per-tier-per-image.

**Cost guards** — each tier is a ~1–3s + $ API call, so: hard cap of 3, dedup by resolved model
(the free-fallback can collapse several tiers onto one model), negative-cache skip, and the loop
_is_ the only retry (no intra-tier backoff). On exhaustion, the last category's placeholder is
rendered.

## Related

- Cascade resolvers: `packages/config-resolver/` (`LlmConfigResolver`, `VisionConfigResolver`, `BaseConfigResolver`)
- Gateway stamping: `services/api-gateway/src/utils/stampResolvedConfig.ts`, `jobChainOrchestrator.ts`
- Worker vision: `services/ai-worker/src/services/multimodal/` (`VisionProcessor`, `visionAuthResolver`)
- Config cascade design (behavior/context overrides, a _different_ cascade): [`CASCADING_CONFIG_PATTERN.md`](CASCADING_CONFIG_PATTERN.md)
