## 🏗 Active Epic: Model Configuration Overhaul

_Focus: make every model axis (text, vision, future image/video) a first-class, reusable config edited through one kind-aware surface. Full motivation + design detail: [`cold/themes/model-configuration-overhaul.md`](cold/themes/model-configuration-overhaul.md)._

_(Promoted 2026-06-28. Phase 1 shipped in beta.140 but the slot was never formally updated — this reconciles it. The prior epic, **Test-Pyramid Taxonomy + Coverage Audit**, COMPLETED 2026-06-26; its writeup is retained at [`cold/themes/test-pyramid-coverage-audit.md`](cold/themes/test-pyramid-coverage-audit.md), slice log in [`cold/epic-log.md`](cold/epic-log.md).)_

### Phase 1 — Vision as a first-class config (✅ SHIPPED — PR #1364, beta.140)

Vision model decoupled from `LlmConfig` via a `kind: 'text' | 'vision'` discriminator: vision presets are `kind='vision'` rows whose `model` IS the vision model; `visionModel` removed from `LlmConfig`; `personality.visionModel` kept as the in-memory carrier, filled gateway-side by `VisionConfigResolver` (mirrors `TtsConfigResolver`). Schema migration (kind + per-kind partial-unique default indexes + vision FK/join columns), `VisionConfigBootstrap` seed, per-kind default/list/name-check scoping in `LlmConfigService`, surface amputation. Vision is **seed/DB-only — no editing UI yet** (that's Phase 2).

### Phase 2 — Editing surface + capability filtering (IN PROGRESS)

Make vision (and future-modality) configs editable, reusing Phase 1's kind-aware service layer. **Council-reshaped 2026-06-28** (GLM-5.2 / Kimi-K2.7 / Qwen-3.7-max) into slices — full design + rationale in [`cold/themes/model-configuration-overhaul.md`](cold/themes/model-configuration-overhaul.md):

- [x] **S0 — resolver kind-scoping bug fix** (PR #1374) — `LlmConfigResolver.getFreeDefaultConfig()` could return the seeded vision free-default for a text resolution; scoped to `kind:'text'`. Shipped standalone (latent prod bug), released in **beta.141** (2026-06-28).
- [x] **S1 — kind-aware backend** (PR #1376) — `LlmConfigService` kind-parametrized (`list` / `create` / `checkNameExists` / `resolveNonCollidingName`) + `getById` `expectedKind` post-fetch gate; schema `kind` (optional on create, immutable — absent — on update); `kind` projected in DETAIL_SELECT for the gate. Extracted the clone-name walk to `llmConfigNameCollision.ts`. No vision exposure yet (routes still text via defaults).
- [ ] **S1b — capability validation + route wiring** (NEXT) — a **`ModelCapabilityService`** over a **unified, provider-agnostic capability shape** (the first step of provider-decoupling — see `cold/ideas.md`). **OpenRouter is authoritative**: if a model exists there, use its capability tags. **z.ai-only models default to text-only** (the z.ai coding-plan catalog has no vision today — GLM 5V Turbo isn't on the coding plan; GLM 5.2 is GA on OpenRouter) unless we add explicit modality info to the z.ai constants (`ZAI_MODEL_CATALOG`). Vision configs **fail-closed** when the model can't be confirmed vision-capable. PLUS **route-layer kind threading** — thread the request's kind into `requireKind` / `checkNameExists` / `list` / `getById` (the #1376 review flagged this as REQUIRED before any vision route goes live; until then the text-only invariant holds because vision is seed/DB-only).
- [ ] **S2 — commands** — `kind` choice option on the four default-setters + `/preset create` (kind survives the modal via custom-ID) + autocomplete/browse kind-filtering + **vision-aware write paths** (write the vision FK columns `defaultVisionConfigId`/`visionConfigId` when kind=vision).
- [ ] **S3 — admin dashboard: DEFERRED** — Discord modals are text-only + select menus cap at 25, so a model-PICKER dashboard fights the platform; model selection stays in the autocomplete-backed commands. Revisit with a web UI or as a preset-SELECTION-only dashboard.

**Already done in Phase 1** (not Phase 2): `CONFIG_KINDS` / `ConfigKind` / `toConfigKind()`; per-kind `setAsDefault` / `setAsFreeDefault`; the kind-scoped partial-unique default indexes. Dense per-slice detail → [`cold/epic-log.md`](cold/epic-log.md) as it ships.

### Phase 3 — Auto-fallback unification (DEFERRED)

Fold guest-downgrade + main-model-vision + fallback into the resolver cascade as an ordered chain (primary → vision global default → free default) + an explicit `[VISION_UNAVAILABLE]` signal when exhausted. Includes the negative-cache-key-by-model fold-in so a model swap / fallback re-attempts immediately instead of waiting out the cooldown. This is the original user "near-term want" (auto-fallback on vision failure).

### Phase-1 cleanup follow-ups

Round-2 review nits from PR #1364 (kind type-tighten, `requireKind` leniency, `setAsDefault` null-path, warn/comment polish) — tracked in [`cold/follow-ups.md`](cold/follow-ups.md); fold into a Phase-2 slice where they overlap.
