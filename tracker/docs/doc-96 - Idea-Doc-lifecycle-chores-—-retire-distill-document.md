---
id: doc-96
title: 'Idea: Doc-lifecycle chores — retire, distill, document'
type: other
created_date: '2026-09-04 15:49'
---

### Idea: Doc-lifecycle chores — retire, distill, document

_Focus: one pass, one PR — retire two completed proposals into reference, distill one theme doc, and write one missing eval section, all executing the same spec._

## Why one doc

Four chores, one shared specification: `07-documentation.md` § Lifecycle Rules. Two are "a completed proposal is verified-then-deleted, but it holds the only record of X"; one is "a theme file is a working surface, not an archive"; one is "the convention exists in four harnesses and nowhere as prose." None has a trigger — they are simply undone chores, which is exactly why individual pool slots never surfaced them.

Checked and rejected as owner: **doc-58** (docs/reference drift rewrite pass) is marked *"PASS EXECUTED — shipped in PR #1968"* and is historical record only.

**Selection cost: none.** No query was ever going to offer these; a single doc-hygiene PR closes all four.

## Members

- **TASK-250 — Retire the free-tier-zai-piggyback proposal into reference docs** (filed 2026-07, was state:ready size:S). The proposal shipped (slice 2) but holds the only record of the probe-verified z.ai quota-endpoint response shape and the 429 business-code table, so it now sits as a completed proposal instead of reference material. Fix shape: move the endpoint shape and code table into `docs/reference/` — alongside the `REASONING_MODEL_FORMATS`-style provider references — then delete the proposal per the doc lifecycle rule. Trigger/cost: doc-lifecycle hygiene without losing the only shape record; the task's promote-when ("after the dev-enable observation window confirms the endpoint shape is stable") is satisfied by one poll cycle of real use. Evidence 2026-09-04: `ls docs/proposals/backlog/free-tier-zai-piggyback.md` → present, not yet retired.
- **TASK-257 — Retire the admin-runtime-settings artifact into reference docs** (filed 2026-07, was state:dependent size:S). All four phasing rows shipped (#1605/#1616/#1617/#1618), but the artifact holds the registry criteria, the D4 SWR contract, the D12 category semantics, and the council record. Fix shape: distill the durable pieces — settings-registry how-to, floor semantics, descent category table — into `docs/reference/` (likely `features/` or `architecture/`), then delete the proposal, keeping the config-cascade cross-links intact so `guard:proposal-links` stays green. Trigger/cost: **still gated** — promote after the operational tail closes (Railway cleanup done + dev walk passed); until then the artifact is the live runbook, so this is the one member of the four that is not startable today. Evidence 2026-09-04: `ls docs/proposals/backlog/admin-runtime-settings.md` → present; `git log --oneline --grep="admin-runtime-settings"` → last activity is doc amendments, no closure note, and no completion note for the operational tail found in `CURRENT.md` or `backlog/`.
- **TASK-406 — Document the pool/judge/qrels eval flow in `MEMORY_EVAL.md`** (filed 2026-08, was state:ready size:S). `MEMORY_EVAL.md` documents only `eval:memory`, while the mine → pool → judgment-sheet → qrels → score loop is now the backbone of 4+ harnesses (fold, fact, allocation, voice-consistency) and exists nowhere as prose, so each new harness re-derives the conventions from the previous one. Fix shape: one section in `docs/reference/testing/MEMORY_EVAL.md` covering the loop, the "runner is eval-only, math is committed + CI-tested" convention, the prefix-keyed qrels + reconcile-ambiguity contract, and the blinded owner-sheet variant the voice harness added. Acceptance: a new harness author can follow the doc without reading a sibling harness end to end. Evidence 2026-09-04: `grep -n "^#\|qrels\|judgment.sheet" docs/reference/testing/MEMORY_EVAL.md` → headings are only "What it does / Baselines and phase gates / Accreting goldens"; no qrels or judgment-sheet content.
- **TASK-25 — Distill the closed-probe archaeology out of the TTS re-evaluation material** (filed 2026-07, was state:ready size:S). Fix shape: move the closed-probe archaeology into `docs/research/` per the completed-writeups policy, leaving only open work behind — theme files are working surfaces, not archives. **RETARGET (2026-09-04): the task names `docs/proposals/backlog/self-hosted-tts-byok-re-evaluation.md`, which no longer exists at that path — commit `d4b21bb27` moved it VERBATIM into `tracker/docs/doc-20` (Theme: Self-Hosted TTS BYOK Re-Evaluation — NeuTTS Air, abandoned 2026-05-13). Only the container changed; the distillation still has not happened, so the condition is NOT resolved. Re-scope the work to doc-20.** Trigger/cost: 213 lines of RTF probe tables and dropped-candidate archaeology are still mixed with open work in a live tracker doc. Evidence 2026-09-04: `find docs -iname "*self-hosted-tts-byok*"` → empty; reading doc-20 whole → still carries the full probe archaeology; `git log --oneline --diff-filter=D` on the old path → `d4b21bb27`, a substrate migration rather than a distillation.

## Superseded tasks (2026-09-04 pass)

TASK-250, TASK-257, TASK-406, TASK-25
