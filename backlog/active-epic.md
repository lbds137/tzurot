## 🏗 Active Epic: NONE — slot open between epics

_The previous Active Epic, **Test-Pyramid Taxonomy + Coverage Audit**, COMPLETED 2026-06-26 (Phases 1–4, PR1–7). The slot is open — pick the next theme from [`cold/queue.md`](cold/queue.md). Theme writeup retained at [`cold/themes/test-pyramid-coverage-audit.md`](cold/themes/test-pyramid-coverage-audit.md); slice log in [`cold/epic-log.md`](cold/epic-log.md); git preserves the full pre-close roadmap._

### Promote the next epic (per `.claude/rules/06-backlog.md`)

1. Pick the next theme from [`cold/queue.md`](cold/queue.md) by dependency + value. Each substantial pick deserves a council pass (GLM-5.2 / Kimi-K2.7 / Qwen-3.7) before plan-mode.
2. Move that theme's `cold/themes/<slug>.md` content into this file (slim roadmap here; dense per-PR detail → [`cold/epic-log.md`](cold/epic-log.md)). Remove its bullet from `cold/queue.md`.
3. Update `now.md` › 🎯 Current Focus to point here.

### Just-closed epic — Test-Pyramid Taxonomy + Coverage Audit (✅ 2026-06-26)

Adopted the canonical Clemson/Fowler 5-tier taxonomy and reclassified the suite to it; built a **code-derived coverage topology** (every cross-service surface enumerated from code, each carrying a per-surface mechanism marker + required tier; committed `coverage-topology.json` byte-compared in CI via `topology:check`); then deliberately populated the previously-hollow **contract tier** — exactly where recent prod bugs cluster.

- **PR1 (#1346)** — Redis keystone: real Redis everywhere, killed the CI/local mock-split (+2 latent bugs it hid).
- **PR2 (#1347)** — tier honesty + CI cleanup: ran the contract tier in CI; reclassified the mis-tiered golden-fixture contract; renamed `integration-tests`→`component-tests`.
- **PR3 (#1353)** — BullMQ queue contract: golden-fixture producer/consumer halves replace the 2 circular tests.
- **PR4 (#1354)** — envelope scenarios: parameterized the bot-client→worker golden-fixture contract (voice / channel-env / mention).
- **PR5 (#1356)** — execution-check ratchet: topology upgraded PRESENCE→EXECUTION (a contract test must IMPORT the real producer/consumer symbol; ts-morph import-assertion).
- **PR6 (#1357)** — voice-engine cross-language contract: Python producer fixture-equality + TS Zod schemas replacing the unsafe `as` casts in `VoiceEngineClient`.
- **PR7 (#1358)** — close-out grab-bag: deferred Phase-4 nits + voice error-path schema validation.

**Parked follow-ons (in `cold/`):** flow-level integration/e2e gate ([`cold/follow-ups.md`](cold/follow-ups.md); trigger = a prod bug that passes every seam contract but fails on multi-service state/sequencing); post-deploy smoke check + a `flows.md` inventory ([`cold/ideas.md`](cold/ideas.md)); HTTP bot-client→gateway contract by-shape ([`cold/follow-ups.md`](cold/follow-ups.md) "Contract tests for HTTP API"). **Dropped** (close-out council, gold-plating): the compile-time contract-test harness. The e2e tier stays 0 by conscious choice — the post-deploy smoke check is the better solo spend.
