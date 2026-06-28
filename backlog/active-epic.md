## 🏗 Active Epic: Model Configuration Overhaul

_Focus: make every model axis (text, vision, future image/video) a first-class, reusable config edited through one kind-aware surface. Full motivation + design detail: [`cold/themes/model-configuration-overhaul.md`](cold/themes/model-configuration-overhaul.md)._

_(Promoted 2026-06-28. Phase 1 shipped in beta.140 but the slot was never formally updated — this reconciles it. The prior epic, **Test-Pyramid Taxonomy + Coverage Audit**, COMPLETED 2026-06-26; its writeup is retained at [`cold/themes/test-pyramid-coverage-audit.md`](cold/themes/test-pyramid-coverage-audit.md), slice log in [`cold/epic-log.md`](cold/epic-log.md).)_

### Phase 1 — Vision as a first-class config (✅ SHIPPED — PR #1364, beta.140)

Vision model decoupled from `LlmConfig` via a `kind: 'text' | 'vision'` discriminator: vision presets are `kind='vision'` rows whose `model` IS the vision model; `visionModel` removed from `LlmConfig`; `personality.visionModel` kept as the in-memory carrier, filled gateway-side by `VisionConfigResolver` (mirrors `TtsConfigResolver`). Schema migration (kind + per-kind partial-unique default indexes + vision FK/join columns), `VisionConfigBootstrap` seed, per-kind default/list/name-check scoping in `LlmConfigService`, surface amputation. Vision is **seed/DB-only — no editing UI yet** (that's Phase 2).

### Phase 2 — Editing surface + capability filtering (IN PROGRESS)

Make vision (and future-modality) configs editable, reusing Phase 1's kind-aware service layer. **Council-reshaped 2026-06-28** (GLM-5.2 / Kimi-K2.7 / Qwen-3.7-max) into slices — full design + rationale in [`cold/themes/model-configuration-overhaul.md`](cold/themes/model-configuration-overhaul.md):

- [x] **S0 — resolver kind-scoping bug fix** (PR #1374) — `LlmConfigResolver.getFreeDefaultConfig()` could return the seeded vision free-default for a text resolution; scoped to `kind:'text'`. Shipped standalone (latent prod bug), released in **beta.141** (2026-06-28).
- [x] **S1 — kind-aware backend** (PR #1376) — `LlmConfigService` kind-parametrized (`list` / `create` / `checkNameExists` / `resolveNonCollidingName`) + `getById` `expectedKind` post-fetch gate; schema `kind` (optional on create, immutable — absent — on update); `kind` projected in DETAIL_SELECT for the gate. Extracted the clone-name walk to `llmConfigNameCollision.ts`. No vision exposure yet (routes still text via defaults).
- [x] **S1b — capability validation** (PR #1377) — `ModelCapabilityService` over a **unified, provider-agnostic `ModelCapabilities` shape** (first step of provider-decoupling — see `cold/ideas.md`); resolution priority **OpenRouter authoritative → z.ai catalog → null** (capabilities are a property of the model, not the user, so `resolve` takes only the model id). z.ai catalog gained optional modality flags (omitted = text-only). `validateLlmConfigModelFields` gained a **fail-closed vision gate** (kind from `body.kind` on create, derived from the immutable row on update; fires only when a model is being set). Create-path name-collision now kind-scoped too. **Route-layer kind threading deferred to S2** (see below) — dormant until commands send `kind=vision`, so it lands with its consumer. Released: pending next beta.
- [ ] **S2 — route kind-threading + commands** (NEXT). **First, the deferred S1b route wiring** (the #1376/#1377 reviews flagged this as required before any vision route goes live): thread the request kind into `list` / `getById` (a `?kind=` query param, default text) + `requireKind` on set-default/free-default/delete/update + `ensureNoNameCollision` on the **update/rename** path (create already threads it). Fold in the #1377-review S2 notes: the `getById` double-trip on model-update (pass the route's already-fetched row kind into `validateLlmConfigModelFields`), the `NameExistsChecker` options-object refactor if the signature grows, and a null-config fallback comment in `resolveEffectiveModelAndKind`. **Then the commands**: `kind` choice option on the four default-setters + `/preset create` (kind survives the modal via custom-ID) + autocomplete/browse kind-filtering + **vision-aware write paths** (write the vision FK columns `defaultVisionConfigId`/`visionConfigId` when kind=vision).
- [ ] **S3 — admin dashboard: DEFERRED** — Discord modals are text-only + select menus cap at 25, so a model-PICKER dashboard fights the platform; model selection stays in the autocomplete-backed commands. Revisit with a web UI or as a preset-SELECTION-only dashboard.

**Already done in Phase 1** (not Phase 2): `CONFIG_KINDS` / `ConfigKind` / `toConfigKind()`; per-kind `setAsDefault` / `setAsFreeDefault`; the kind-scoped partial-unique default indexes. Dense per-slice detail → [`cold/epic-log.md`](cold/epic-log.md) as it ships.

### Phase 3 — Auto-fallback unification (DEFERRED)

Fold guest-downgrade + main-model-vision + fallback into the resolver cascade as an ordered chain (primary → vision global default → free default) + an explicit `[VISION_UNAVAILABLE]` signal when exhausted. Includes the negative-cache-key-by-model fold-in so a model swap / fallback re-attempts immediately instead of waiting out the cooldown. This is the original user "near-term want" (auto-fallback on vision failure).

### Phase-1 cleanup follow-ups

Round-2 review nits from PR #1364 (kind type-tighten, `requireKind` leniency, `setAsDefault` null-path, warn/comment polish) — tracked in [`cold/follow-ups.md`](cold/follow-ups.md); fold into a Phase-2 slice where they overlap.
