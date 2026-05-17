# Current

> **Session**: 2026-05-16 (marathon) — CPD Reduction Campaign **CLOSED** across 5 PRs (#1038, #1039, #1040, #1041, #1042). Architecture hygiene push following user directive "code quality improvement + DRY violations resolved + viable enforcement mechanism." All three goals delivered.
> **Version**: v3.0.0-beta.122 (released 2026-05-16, pre-campaign)
> **🚧 Release freeze status**: LIFTED. No release in progress.

---

## Next Session Goal

**Open** — pick from any of the deferred follow-up campaigns documented in [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](docs/reference/CPD_CAMPAIGN_AUDIT.md), or other backlog work:

1. **Self-Hosted TTS + BYOK Re-Eval — Step 0 probes** ([future-themes.md](backlog/future-themes.md)): hands-on probe (30 min each) of OmniVoice / F5-TTS / CosyVoice. Plus verify Pocket TTS long-form support.
2. **API Security Hardening** ([future-themes.md](backlog/future-themes.md)): rate limiter + helmet/CORS + `/voice-references/:slug` enumeration risk.
3. **Deferred CPD follow-up campaigns** (each deserves its own council pass before pursuing):
   - bot-client command-pattern campaign (Discord.js patterns)
   - ai-worker service-pattern campaign (voice providers, key validators)
   - api-gateway override-route campaign (cascade semantics, different from CRUD)
   - In-file local-helper extraction sweep
   - Service-layer parallel cleanup (`LlmConfigService` ↔ `TtsConfigService`)
4. **Open tooling polish** (low-priority, dropped from PR #1042 final rounds):
   - `cpd:update-baseline` CLI helper (manual edit of `cpd-baseline.json` works today)
   - Colocated test for `commands/cpd.ts` `parseBaseline` validation paths
   - Cache `process.cwd()` once in `filterReport` (micro-optimization)
   - Better CI failure message when prior `pnpm cpd` step didn't emit JSON

**Read first**:

- [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](docs/reference/CPD_CAMPAIGN_AUDIT.md) — campaign close-out audit with all remaining clone pairs classified
- [`.claude/rules/02-code-standards.md`](.claude/rules/02-code-standards.md) — new "Duplication, Helpers, and the CPD Ratchet" section documents the helpers boundary + 2-callback ceiling rule
- [`backlog/active-epic.md`](backlog/active-epic.md) — TTS Engine Upgrade epic still functionally complete
- [`backlog/quick-wins.md`](backlog/quick-wins.md) — empty

---

## This Session — CPD Reduction Campaign (2026-05-16)

Marathon session pursuing the durable goal "drive jscpd count to 0 with enforcement to prevent regression." Three council models (Gemini 3.1 Pro Preview, Kimi K2.6, GLM 5.1) consulted across multiple decision points.

### Five PRs merged

| PR    | Title                                                                          | Result                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1038 | `chore(repo): raise jscpd minLines from 5 to 10`                               | 178 → 107 clones (40% reduction — exposed that 71 clones were structural language boilerplate at minLines=5)                                     |
| #1039 | `refactor(api-gateway): extract shared config-route helpers (admin pilot)`     | 5 thin helpers extracted to `configRouteHelpers.ts`; admin pair (admin/{llm,tts}-config) consolidated                                            |
| #1040 | `refactor(api-gateway): apply config-route helpers to user/{llm,tts}-config`   | Pattern propagated to user-side; +1 new helper (`findConfigOrSendNotFound`) for permission-gated routes                                          |
| #1041 | `refactor(api-gateway): tighten collision flow on user-side update handlers`   | Option A (collision-flow extraction) passed the 2-callback ceiling rule with 0 new callbacks; `applyOwnerNamePromotion` extracted to shared util |
| #1042 | `chore(repo): jscpd post-filter + CI ratchet + boundary docs (campaign close)` | Post-filter (ts-morph-free line-pattern heuristic) + differential CI ratchet + audit doc + boundary documentation in rules                       |

### Three goals delivered

| Goal                       | Status                                                                                                                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Code quality improves   | ✅ 7 helpers extracted (`parseBodyOrSendError`, `findConfigOrSendNotFound`, `findGlobalConfigOrSendError`, `findAdminUserOrSendError`, `ensureNoNameCollision<TScope>`, `shapeDeleteResponse`, `applyOwnerNamePromotion<TBody>`); type safety preserved; 144 route tests pass unchanged |
| 2. DRY violations resolved | ✅ Real copy-paste eliminated across 4 CRUD config-route files; remaining is structural-skeleton (accepted), in-file (separate concern), or out-of-scope domain (per council)                                                                                                           |
| 3. Sustainable enforcement | ✅ `pnpm ops cpd:filtered` + `pnpm ops cpd:check` + CI ratchet on `.github/baselines/cpd-baseline.json`; ceiling = filteredLines (1752) + graceMargin (10) = 1762                                                                                                                       |

### Key insights captured

- **jscpd is the wrong tool for measuring duplication in well-abstracted TypeScript.** Token-stream matching can't distinguish "standardized helper call site" from "copy-pasted logic." Three council models agreed. Solution: line-pattern post-filter that excludes call-expression-dominant fragments.
- **2-callback ceiling rule** added to `.claude/rules/02-code-standards.md` — when considering helper extraction, if the proposed signature needs more than 2 callback/predicate parameters to handle observed divergences, leave the code inline. Wrong Abstraction is more expensive than duplication.
- **State 3 — "helpers with documented boundary"** is the right campaign-close state, per GLM. Not "stop now leaving partial abstraction" (Gemini's original framing) and not "extract until zero" (Kimi's). The boundary is documented in rules.

### What was deliberately left for follow-up campaigns

Per the campaign audit, the following are explicit out-of-scope items that each deserve their own council pass (NOT deferred bugs):

1. **bot-client command-pattern campaign** — `commands/character/*`, `commands/persona/*`, etc. (Discord.js patterns)
2. **ai-worker service-pattern campaign** — voice providers, key validators, AI client wrappers
3. **api-gateway override-route campaign** — cascade-override domain (different shape than CRUD; Kimi/GLM both flagged as Wrong Abstraction trap if forced into CRUD helpers)
4. **In-file local-helper extraction** — repeated guards/loops within single handlers; per-file work
5. **Service-layer parallel cleanup** — `LlmConfigService` ↔ `TtsConfigService` siblings

---

## CPD final state

|                                 | Pre-campaign | Now (post-PR5) | Δ                        |
| ------------------------------- | ------------ | -------------- | ------------------------ |
| Raw clones                      | 178          | 113            | -65                      |
| Raw duplicated lines            | 2153         | 1684           | -469                     |
| Raw percentage                  | 1.44%        | 1.12%          | -0.32pp                  |
| **Filtered count (new metric)** | n/a          | **109**        | (excludes call-dominant) |
| **Filtered lines (CI gate)**    | n/a          | **1752**       | ceiling 1762             |

The raw-count headline reduction (-65) came primarily from PR #1038's threshold correction. PRs #1039-1041's helper extractions held the count roughly flat because jscpd flags helper-call shape itself as new clones — the campaign's resolution was to fix the _measurement_ via post-filter, not chase the broken proxy.

---

## Last Session (2026-05-09 → 2026-05-11, extended marathon)

Shipped v3.0.0-beta.120 — TTS Phase 3 end-to-end, 3-PR cross-channel context bug-fix arc, 2-PR Mistral STT critical fix arc, TTS-side attribution mirror (#1016), focused TTS/STT inbox sweep (#1017), coordinated UX rename `personality → character` + `browse → list` (#1020), pre-release sweep (#1021). **17 merged PRs total** + 2 dependabot bumps. Details preserved in git history.

---

## Unreleased on Develop

Five CPD-campaign PRs (#1038-1042) merged 2026-05-16. No production-facing changes; all internal architecture hygiene + tooling. No release needed; will roll into the next feature-release cycle.

---

## Migrations Applied (v3.0.0-beta.120)

All three migration waves were applied to dev + prod during the previous development cycle:

- `add_stt_provider_columns` (#1005, additive)
- `drop_unused_voice_provider_columns` (#1007)
- `add_stt_provider_check_constraint` (#1008)
