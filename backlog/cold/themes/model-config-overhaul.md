# Theme: Model Configuration Overhaul (✅ COMPLETED 2026-07-01)

_Focus: make model configuration capability-driven — a config is `{name, model, params}`; the model's capability (not a `kind` discriminator) decides slot-eligibility; two slots (chat, vision) resolve through one uniform cascade; vision failures auto-fall-back down an ordered chain._

**Status: COMPLETE.** All four phases shipped (beta.140 → beta.143 + the Phase-4 fallback loop merged to develop 2026-07-01). This writeup is retained per the epic-close convention; the detailed slice log lives in [`../epic-log.md`](../epic-log.md). Deferred items live in their own cold entries (linked below) — this file is historical reference, not a work queue.

### Phase 1 — Vision as a first-class config (✅ SHIPPED — PR #1364, beta.140)

Vision configs became real `LlmConfig` rows (`kind: 'vision'`) selectable per-personality/user, replacing the hardcoded vision-model constant. Cleanup nits → `cold/follow-ups.md` (Phase-1 cleanup follow-ups).

### Phase 2 — Editing surface + capability filtering (✅ USER-FACING COMPLETE — S3 deferred)

Browse/edit dashboards + autocomplete for configs; capability badges.

- **S3 — admin model-picker dashboard: DEFERRED** (not epic-blocking) — Discord modals are text-only + select menus cap at 25, so a model-PICKER dashboard fights the platform; model selection stays in the autocomplete-backed commands. **Revisit when**: a web UI exists, or as a preset-SELECTION-only dashboard.

### Phase 3 — Capability-driven config model (✅ COMPLETE)

**Pivot (2026-06-29):** the `kind: 'text'|'vision'` discriminator was the wrong abstraction (caused the "Config not found" vision-default bug, misleading 👁 badge, duplicate configs per model). Re-architected: NO user-facing kind; `ModelCapabilityService` (OpenRouter-authoritative → z.ai catalog → reject-on-unknown) decides slot-eligibility; `AdminSettings` FK pointers replace flag-based defaults (council: Option A on YAGNI grounds).

- [x] **S1** — capability in the list contract (#1384)
- [x] **S2** — user/personality vision slots → capability-gate (#1385)
- [x] **S3** — global/free defaults → `AdminSettings` FK pointers + remove bootstrap (#1388)
- [x] **S4** — capability-driven UX complete (#1418/#1419/#1420 + earlier slices)
- [x] **S5** — tests + release _(reconciled 2026-07-01: the fixture/snapshot/conformance sweep + release shipped as beta.142/.143; the box was never checked at ship time)_

**Deferred (tracked, trigger-gated)**: Phase B `kind`-column drop + name-collision-namespace collapse → `cold/follow-ups.md` ("Phase B — drop the dormant `kind` column"), promote when P3 has soaked clean in prod.

### Phase 4 — Vision auto-fallback (✅ COMPLETE)

Runtime retry-down-the-chain (`describeImageWithFallback`): primary → stamped DB fallbacks → hardcoded floor; terminate on image-intrinsic failures; per-image quota; exhaustion renders a source-aware placeholder. Design doc: [`docs/reference/architecture/model-selection-pipeline.md`](../../../docs/reference/architecture/model-selection-pipeline.md).

- [x] **A** — `getFreeDefaultVisionConfig()` reader (#1426)
- [x] **B** — stamp `visionFallbackModels[]` on the job envelope (#1427)
- [x] **C1** — model-parameterized `resolveVisionAuth` (#1428)
- [x] **D** — model-selection pipeline doc
- [x] **C2b** — the loop + integration (#1429; 5 review rounds → the `visionFallbackChain.test.ts` wiring/seam test + the assert-at-seam rule #1430)

**Open follow-ups (tracked in `cold/follow-ups.md`)**: C2b-1..5 (fast-path-per-tier [priority], quota latch, observability, dead code, string dup) + RAG-family fallback wiring.
