## 🏗 Active Epic: Test-Pyramid Taxonomy + Methodical Coverage Audit

_Focus: adopt one canonical 5-tier testing taxonomy (Clemson/Fowler), reclassify our existing tests to it, then methodically audit Tzurot's coverage tier-by-tier and fill the gaps — flagship being a bot-client→worker envelope contract test that locks the claim the 2.5d epic deleted code against._

> Promoted from `cold/queue.md` on 2026-06-25, after the "Slim `@tzurot/common-types`" epic (PR-2n) closed — extraction arc (config-resolver / identity / conversation-history / cache-invalidation) + close-out sweep both complete; its detailed log stays in [`cold/epic-log.md`](cold/epic-log.md) as historical reference. **The full theme writeup — canonical taxonomy table, schema-vs-contract disambiguation, sources — lives in [`cold/themes/test-pyramid-coverage-audit.md`](cold/themes/test-pyramid-coverage-audit.md).** This file is the roadmap + current/next phase only.

### Why this epic exists

Surfaced 2026-06-20 during the 2.5d Prisma-eviction epic. The always-loaded testing taxonomy carried the thinnest model, which steered 2.5d toward "unit tests + existing int tests" while the cross-service contract tier — where that epic's central risk lived — stayed off-radar. Worse: every 2.5d slice deleted bot-client code on the claim "the worker re-derives identical context from the raw envelope," and that claim is a **producer↔consumer contract** (bot-client `rawAssemblyInputs` → worker `ContextAssembler`) with **no standing contract test**. Thin taxonomy → thin coverage.

### Canonical model (Clemson/Fowler 5-tier)

unit · **component** (`*.int.test.ts`, PGLite — currently mislabeled "integration") · **integration** (`*.e2e.test.ts`, one real external dep) · **contract** (provider↔consumer agreement; only the BullMQ pair today) · **e2e** (full system, effectively none). Canonical definitions are single-sourced in `docs/reference/guides/TESTING.md` (enforced by `guard:test-taxonomy`).

### Phase 1 — Reconcile the taxonomy (docs) ✅ DONE (#1284)

Canonical `## Test Tier Taxonomy` block in TESTING.md; `.int` reclassified as component (suffix kept); schema-vs-contract disambiguated; both enforcement seeds shipped (`guard:test-taxonomy` binary sync-check + `test:tiers` report-only).

### Phase 1.5 — Pilot audit of the 2.5d-touched surface ✅ DONE (#1285)

Scoped the first audit to the freshest, highest-risk surface. Found the envelope SHAPE was already schema-locked, but nothing tied real-producer-output → schema → real-consumer-derivation. Shipped 3 tests (producer-conformance, consumer-at-schema-boundary, and a NEW component/PGLite assembler test that un-stubs what `AIJobProcessor.int` skips). Methodology (gap-matrix → fill-the-right-tier) validated for Phase 2.

### Phase 2 — code-derived coverage topology (sliced 2a → 2b)

**Council pass done 2026-06-25** (GLM-5.2 / Kimi-K2.7 / Qwen-3.7) → reframed from a hand-authored matrix to a **code-derived coverage topology**.

**2a ✅ SHIPPED (#1341)** — `generateCoverageTopology()` enumerates every cross-service surface from code: one per `ROUTE_MANIFEST` route + the 3 payload-bearing `JobType`s + the context-assembly envelope (154 surfaces). Each carries a `mechanism` marker (route-conformance / bullmq-contract / golden-fixture) and **requires the tier its mechanism provides** (route→component since the conformance harness is a component-tier test that verifies the route's I/O contract; jobs/envelope→contract) — which resolves #1340's false-contract-gap concern via the per-surface mechanism marker. Report-only (`pnpm ops topology:generate`); `actualTiers` is optimistic (= requiredTiers per mechanism).

**2b ✅ SHIPPED (#1342)** — mechanism-PRESENCE verification + the drift gate. `generateCoverageTopology` now probes the filesystem per surface (route → conformance harness exists; job → its `*JobDataSchema` appears in a `.safeParse(`/`.parse(` call under `tests/e2e/contracts/`; envelope → both golden-fixture halves), setting `actualTiers` to empty when the mechanism's test is absent (a real `surfaceGap`). `topology:generate --write` commits `packages/tooling/coverage-topology.json` (`.prettierignore`d); `topology:check` byte-compares it (lockfile-diff, like `codegen:routes --check`), wired into `pnpm quality` + the CI lint job. Folded in the #1341 review items (exported `EXEMPT_ROUTE_IDS`, `Record<JobType, string | null>` exhaustiveness guard, producer assertions, trimmed phase-narration) AND the #1342 review items (tested `checkCoverageTopology` across all 3 branches, `Record<CoverageSurfaceMechanism, …>` dispatch, O(1) exempt Set). 154 surfaces, 0 gaps. **Phase 2 COMPLETE.**

`test:audit` measures colocation, not tier coverage — this audit is behavioral.

### Phase 3 — Gap-fill ✅ DONE

- ✅ **Flagship (#1340)** — bot-client→worker envelope contract via the **golden-fixture** pattern: committed fixtures in `@tzurot/test-utils` are the contract artifact; a producer guard (bot-client, `toMatchFileSnapshot`) + consumer derivation over the same fixture (ai-worker, PGLite) lock "given this `rawAssemblyInputs`, the worker assembles this context" — no cross-package import/mock (the structural block; council-reshaped). Locks the seam 2.5d deleted code against.
- ✅ **`ContextAssembler` component tests over PGLite (#1345)** — the four previously mocked-only seams now have real-data coverage: cross-channel decoration (real persona-scoped fetch + env-map vs fallback), reference enrichment (voice-transcript re-derivation + dedup stub), content rewriting (DB-fallback mention resolution → correct persona), and weigh-in/incognito (empty-channel assembly + incognito short-circuit). 2 → 8 cases; no production bug surfaced (the worker re-derivation claim is now locked by real data, not mocks).
- ✅ `buildContext`-synthetic-anchor lock (#1283 — caught a real empty-channel weigh-in crash; proof the component-level test catches what buildContext-mocking unit tests structurally can't).

**Epic status: Phases 1–3 DONE. A 2026-06-25 audit + council reframing opened Phase 4 (below) — the real remaining leverage.**

### Phase 4 — Seam Contract Coverage (ACTIVE)

_Focus: populate the contract tier deliberately — recent prod bugs cluster at service seams, and the tier was hollow._

**Audit (2026-06-25):** the unit base + 19 PGLite component tests are solid; the shakiness is the upper pyramid. The "integration" tier was 1 PGLite infra-smoke test (mislabeled); the "contract" tier was 2 **circular** BullMQ tests (hand-write a payload, validate it against the schema it was written to satisfy — never import producer code) + the 1 genuinely-real golden-fixture contract mis-tiered as `component`; **none ran in CI**. Plus a CI/local Redis mock-split (`isCI()` → real redis in CI, low-fidelity mock locally) that hid bugs.

**Council (GLM-5.2 / Kimi-K2.7 / Qwen-3.7, 2026-06-25):** contract tests are **mid-pyramid** (seam scope, unit cost) — populate by **behavioral shape** (~15–25, not per-route); pattern = real producer → schema → real consumer **in-memory** (queue/Redis round-trips are separate _integration_ tests, kept distinct); **real Redis everywhere** (keystone); enforce via topology **presence→execution** upgrade + an **import-assertion** anti-circularity guard (every required seam needs a passing test that imports both real producer + consumer). Owner scope: "full core + voice-engine." Full plan: `~/.claude/plans/floofy-rolling-crane.md`.

Roadmap:

- ✅ **PR1 — Redis keystone (#1346)**: real Redis everywhere; deleted the `isCI()` mock-split + `RedisClientMock`; fixed 2 latent bugs it hid (Vitest 4 `singleFork` silently ignored → cross-fork `flushdb` race, fixed via `fileParallelism: false`; `localhost`→`::1` IPv6 ECONNREFUSED, fixed via 127.0.0.1 test default).
- ✅ **PR2 — tier honesty + CI cleanup (#1347)**: reclassified the golden-fixture consumer `component`→`contract` (+ coverageTopology path, integration-config glob widened to `**/*.contract.test.ts`, unit-config excludes both suffixes); deleted the PGLite infra-smoke test; **ran the contract tier in CI** (`pnpm test:integration` step); renamed `integration-tests`→`component-tests` + dropped its dead Postgres service/migration (verify-by-removal: green with Postgres stopped) + flag `integration`→`component`; killed the `@tzurot/e2e` vestige `vitest run` script; synced TESTING.md (colocated contract tests) + tooling fixtures + README Redis note. PR2b folded in. 3 review rounds (all real reclassification-ripple staleness).
- [ ] **PR3 — BullMQ queue contract**: rewrite the 2 circular tests → real `jobChainOrchestrator` producer → worker schema → real handler, per JobType.
- [ ] **PR4 — envelope scenarios**: parameterize the golden-fixture for cross-channel env / voice / mention-rewrite (the #1340 grab-bag scenarios).
- [ ] **PR5 — execution-check ratchet**: topology presence→execution + import-assertion anti-circularity guard + baseline/ratchet.
- [ ] **PR6 — voice-engine schema-first**: Pydantic→JSON-Schema contract artifact; TS + Python both validate the committed fixtures (TS↔Python drift).
- _Long tail (backlog):_ HTTP bot-client→gateway by-shape ([`cold/follow-ups.md`](cold/follow-ups.md) "Contract tests for HTTP API"); Redis pub/sub cache-invalidation contracts. e2e tier stays 0 by conscious choice (a post-deploy smoke check is the better solo spend).

The pre-2.5d grab-bag (#1339/#1340/#1342/#1345 nits) folds into the relevant PR above where files overlap (ci.yml naming nits → PR2; envelope scenarios → PR4).

### Enforcement — ✅ RESOLVED: no standalone tier-audit ratchet (council 2026-06-25)

A 3-model council (GLM-5.2 / Kimi-K2.7 / Qwen-3.7) **unanimously rejected** building a standalone `test:tier-audit` per-area tier-matrix ratchet: it would duplicate `test:audit` (artifact→tier: Prisma-service→component, schema→contract) + `topology:check` (the 154 cross-service surfaces), and — with integration=1 / e2e=0 in the current distribution — a broad "every area needs every tier" gate would baseline almost the whole repo as a meaningless `knownGaps` dump (Qwen: _"guarding an empty room"_). **Decision**: enforcement = `test:audit` + `topology:check`; **`test:tiers` stays the report-only dashboard** (the compass for where to invest). The residual is COVERAGE, not tooling.

**Shipped the one council-endorsed extension (#1344)** — `test:audit` now scans the extracted packages (`packages/identity` + `packages/conversation-history`) so their Prisma services are ratcheted too (the slimming epic had moved them outside the audit's hardcoded dir list). A flow-level integration/e2e gate (Kimi's "declared-flow" layer in `topology:check`, baseline + sunset) is **deferred until that coverage exists to lock** — i.e. after Phase 3. Two follow-ups filed to `cold/follow-ups.md` (the `*Loader.ts` naming gap; auto-discovering `packages/*/src`).

### Resolved sub-decisions

- Suffix **rename** — ✅ DONE (#1339): `.int.test.ts`→`.component.test.ts`, `.e2e.test.ts`→`.integration.test.ts` / `.contract.test.ts`; `classifyTestFile` is now a pure suffix check (directory-location rule gone).
- `.schema.test.ts` adopt-or-drop — ✅ DROPPED (#1339): the `schema` file-kind is gone; a Zod schema test is a plain `*.test.ts` (unit-tier).

### PR B ✅ SHIPPED (#1340)

Golden-fixture flagship + a report-only coverage-topology skeleton (`coverageTopology.ts` + `pnpm ops topology:generate`, seeded with the locked context-assembly surface). Plan: `/home/deck/.claude/plans/floofy-rolling-crane.md`. (Phase 2 — the full code-derived generator + the `topology:check` drift gate — shipped in #1341/#1342; the `test:tier-audit` ratchet is the remaining enforcement bulk.)

### Epic grab-bag — consolidated cleanup PR (after the headline items)

Per user 2026-06-25: consolidate the epic's non-blocking review nits into ONE grab-bag cleanup PR after the headline work (Phase 2/3/enforcement), not a PR per nit. All are direct consequences of #1339/#1340 — epic-scoped, tracked here (not cold/follow-ups).

**From #1339 (suffix rename):**

- [ ] Drop dead `.component.test.ts` guards subsumed by the `.test.ts` check: `audit-unified.ts:70`, `scripts/audit-route-auth-matrix.ts:517`, `knip.json` (verify knip glob semantics first). Fix `audit-unified.ts:235` — its `findTestedSchemas` filters `.contract.test.ts` but `readdirSync` is non-recursive so that branch is dead (drop it, or make the scan recursive if contract-schema coverage should count). [#1339 introduced the `:235` dead branch.]
- [ ] `ci.yml` "integration"→"component" naming: step label L344, job name `integration-tests:` L290, Codecov `flags: integration` L362, coverage dir L361 + the coupled `reportsDirectory` in `vitest.component.config.ts`. **Coordinate**: the job name is likely a required branch-protection check (rename → update protection, else the old name blocks merges forever); the flag rename resets Codecov trend history. `ci.yml` edits are safe on develop (claude-review lives in `claude-code-review.yml`). Rename all four in sync (+ branch-protection update) OR keep `flags: integration` as a stable label.
- [ ] Rename `tests/e2e/` dir (low priority; the suffix carries the tier now) — update `vitest.integration.config.ts` include glob + `audit-unified.ts` `e2eTestsDir`. Do when a true e2e test arrives or a `tests/` reorg.

**From #1340 (golden-fixture contract):**

- [ ] Path-traversal guard on `contractFixtureFile(name)` — reject `..` / leading-`/` (test-only infra; defense-in-depth per 00-critical's path rules).
- [ ] Direct unit test for `loadContractFixture` (currently only exercised via the consumer test).
- [ ] Enrich the envelope contract with more fixture scenarios: **`with-channel-environment`** (the cross-channel `knownChannelEnvironments` seam — untested in #1340; the core content+extended-context seam IS locked), **voice** (empty content + `rawRoutingTranscript`), and a **personal-summon** scenario that exercises mention rewriting (#1340's anonymous-summon path passes raw content through by design, so mention-rewrite producer→consumer isn't asserted yet).
- [ ] JSDoc nits: `contractFixtures.ts` `as T` — note callers validate via `rawAssemblyInputsSchema.parse()`; `stableJson` in the producer test — note the trailing-newline-required-by-fixture-format assumption.

**From #1342 (Phase 2b — both non-blocking):**

- [ ] `CoverageSurface.schemaRef` JSDoc: clarify that for `http-route` surfaces it's the `METHOD /path` signature (shared by ~13/150 routes where global/user variants live at the same path behind different auth middleware), NOT a unique key — `id` is the unique key. Pre-empts a "duplicate = generation bug?" misread when diffing the committed topology.
- [ ] When Phase 4's `test:tier-audit` ratchet lands, have `topology:generate` list the gap surfaces by name (not just a count) so the developer doesn't need a second pass. Folds naturally into Phase 4's output design.
