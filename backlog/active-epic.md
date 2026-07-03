## 🏗 Active Focus: Spinoff-Theme Knockout (beta.146+)

_Focus: burn down the themes spun off from completed epics instead of picking a new epic (user decision 2026-07-02). The `cold/queue.md` pick is deferred until this sweep lands._

_Not a classic single epic — a sweep over the sibling themes that exist because a finished epic shed them. Warmup items run first (below), then the themes by dependency + size. Council passes stay per-theme where flagged; each theme keeps its detail in its own `cold/themes/` file — this roadmap is just ordering + gates._

### Warmup (agreed 2026-07-02 — before theme work)

1. ✅ **Effective-route threading on the auto-promotion both-fail path** (error-footer mis-attribution) — SHIPPED as #1456 (2026-07-02): the error footer now renders the full route chain (`via Z.AI Coding Plan → OpenRouter (both routes failed)`). Closes the z.ai "routing bug" confusion family (diagnosed 2026-07-02: fallback visibility, not mis-routing).
2. 🧹 **`guard:workflow-sync` narrowing** to the claude workflow files (Quick Win; spec on the follow-ups row)
3. 🧹 **Supervised lifecycle redeploy** — `railway redeploy --service bot-client`, user present (Quick Win)
4. 🧹 **Prod TTS pointer verification** — `/voice view` + one generation by a no-override user (Quick Win)

### The spinoff themes (ordered)

| #   | Theme                                                                                                              | Source epic                             | Gate / note                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [PGLite Fidelity + Real-Postgres Integration Tier](cold/themes/pglite-fidelity-real-postgres-integration-tier.md) | Test-Pyramid epic + vision-config audit | Phase 1 (DEFERRABLE-FK harvester) is small + self-contained — good first theme PR; Phases 2–3 (provision Postgres → write the tests PGLite can't host) are the meat                                                                                                                 |
| 2   | [LLM Config Legacy-Column Retirement](cold/themes/llm-config-legacy-column-retirement.md)                          | Model Config Overhaul                    | Phase A prep shipped beta.143; the DROPs are **destructive migrations** (`MAINTENANCE_MODE` interplay) and want the pointer reads to soak in prod — schedule mid/late cycle. Phase B additionally needs the name-collision namespace collapse first                                  |
| 3   | [Adjacent CPD Follow-Up Campaigns](cold/themes/adjacent-cpd-follow-up-campaigns.md)                                | CPD campaign close-out                   | Four independent sub-campaigns, each wants its own council pass; the service-layer parallel cleanup (`LlmConfigService` ↔ `TtsConfigService`) is the lowest-blast-radius starter                                                                                                    |
| 4   | [Deterministic Test-Quality Tooling](cold/themes/deterministic-test-quality-tooling.md)                            | seam-bug lineage (#1184, #1429/#1430)    | Mutation-testing pilot (Stryker, one package + ratchet) is the recommended entry; the job-payload contract suite second                                                                                                                                                             |
| 5   | [z.ai Catalog + 402 Error-Shape Verification](cold/themes/zai-402-error-shape-verification.md)                     | April z.ai/credit-cache work             | **Gated on captured samples** — BUT the 2026-06-30 incident logs recorded a real `z.ai 429 → OpenRouter 402 credit check` sequence; check whether those logs contain the 402 body shape before writing this off as still-blocked                                                     |

**Sweep-adjacent smalls** (fold in between themes as quick wins): the human-users-only `requireUserAuth` invariant remainder ([theme](cold/themes/enforce-human-users-only-at-auth-middleware.md)) and the Railway log-search ergonomic ops flags ([theme](cold/themes/railway-log-search-dx-for-incident-digs.md)) — both reconciled-small 2026-06-26.

_The completed Model Configuration Overhaul epic's writeup is retained at [`cold/themes/model-config-overhaul.md`](cold/themes/model-config-overhaul.md), slice log in [`cold/epic-log.md`](cold/epic-log.md). Its deferred items: C2b-1..5 + RAG-family fallback wiring in `cold/follow-ups.md`, plus theme #2 above._
