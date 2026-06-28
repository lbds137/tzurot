## 🏗 Active Epic: Model Configuration Overhaul

_Focus: make every model axis (text, vision, future image/video) a first-class, reusable config edited through one kind-aware surface. Full motivation + design detail: [`cold/themes/model-configuration-overhaul.md`](cold/themes/model-configuration-overhaul.md)._

_(Promoted 2026-06-28. Phase 1 shipped in beta.140 but the slot was never formally updated — this reconciles it. The prior epic, **Test-Pyramid Taxonomy + Coverage Audit**, COMPLETED 2026-06-26; its writeup is retained at [`cold/themes/test-pyramid-coverage-audit.md`](cold/themes/test-pyramid-coverage-audit.md), slice log in [`cold/epic-log.md`](cold/epic-log.md).)_

### Phase 1 — Vision as a first-class config (✅ SHIPPED — PR #1364, beta.140)

Vision model decoupled from `LlmConfig` via a `kind: 'text' | 'vision'` discriminator: vision presets are `kind='vision'` rows whose `model` IS the vision model; `visionModel` removed from `LlmConfig`; `personality.visionModel` kept as the in-memory carrier, filled gateway-side by `VisionConfigResolver` (mirrors `TtsConfigResolver`). Schema migration (kind + per-kind partial-unique default indexes + vision FK/join columns), `VisionConfigBootstrap` seed, per-kind default/list/name-check scoping in `LlmConfigService`, surface amputation. Vision is **seed/DB-only — no editing UI yet** (that's Phase 2).

### Phase 2 — Editing surface + capability filtering (NEXT)

Make vision (and future-modality) configs editable, reusing Phase 1's kind-aware service layer. Per user direction 2026-06-27:

- [ ] **Extend EXISTING commands with a `kind` param** (`text | vision`, default `text` for back-compat) — NOT new commands. Parametrize the Phase-1 hardcoded `kind:'text'` filters; config autocomplete reads `kind` and filters to it. Generalizes to future modalities (new `kind` value + a new `XConfigResolver` subclass).
- [ ] **Capability-aware validation** — a modality-scoped model field must REJECT incompatible models (can't set a text-only model as the vision model). Reuse `OpenRouterModelCache.getVisionModels()` / `supportsVision`.
- [ ] **Admin settings dashboard** for model defaults + user overrides (in addition to the commands — give both ergonomics).
- [ ] Absorb deferred **#4 `getById` kind-gate** (gate `getById` + the by-id route reads now that an editing surface makes the read-path gap matter).
- [ ] **`CONFIG_KINDS` / `ConfigKind` in common-types** — verify whether it landed in Phase 1; if not, land it here as the single source the schema/resolver/service/commands all reference.

Substantial → **council pass (GLM-5.2 / Kimi-K2.7 / Qwen-3.7-max) before plan-mode**. Likely sliced into 2–3 PRs. Dense per-slice detail → [`cold/epic-log.md`](cold/epic-log.md) as it ships.

### Phase 3 — Auto-fallback unification (DEFERRED)

Fold guest-downgrade + main-model-vision + fallback into the resolver cascade as an ordered chain (primary → vision global default → free default) + an explicit `[VISION_UNAVAILABLE]` signal when exhausted. Includes the negative-cache-key-by-model fold-in so a model swap / fallback re-attempts immediately instead of waiting out the cooldown. This is the original user "near-term want" (auto-fallback on vision failure).

### Phase-1 cleanup follow-ups

Round-2 review nits from PR #1364 (kind type-tighten, `requireKind` leniency, `setAsDefault` null-path, warn/comment polish) — tracked in [`cold/follow-ups.md`](cold/follow-ups.md); fold into a Phase-2 slice where they overlap.
