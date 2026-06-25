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

**2b ⏳ NEXT** — mechanism-PRESENCE verification + the gate:

- Verify each mechanism's test actually exists (downgrade `actualTiers` to empty → real gap): jobs via the `audit-unified.ts` `(\w+Schema)\.safeParse` grep over `tests/e2e/contracts/`; routes via the conformance harness/registry; envelope via the golden-fixture. This inherently validates the `JOB_PAYLOAD_SCHEMAS` labels against real schema names.
- `--write` (commit `coverage-topology.json`, `.prettierignore`d) + `topology:check` **lockfile-diff CI gate** (Pattern B, like `codegen:routes --check`) wired into `pnpm quality` + ci.yml.
- **Fold in the #1341 review items** (all scoped "before the phase closes"): export `EXEMPT_ROUTE_IDS` + fix the test count assertion (`− EXEMPT.size`); add the `producer` test assertion; a compile-time exhaustiveness guard for `JOB_PAYLOAD_SCHEMAS` (a future payload-bearing `JobType` must be classified, not silently missed); trim the Phase-marker phasing prose from the module JSDoc + `MECHANISM_TIER` doc + the `topology:generate` CLI note (keep the invariant, drop roadmap-rot); condense the `producer:'client'` comment.

`test:audit` measures colocation, not tier coverage — this audit is behavioral.

### Phase 3 — Gap-fill (the big undertaking) ⏳

- ✅ **Flagship DONE (#1340)** — bot-client→worker envelope contract via the **golden-fixture** pattern: committed fixtures in `@tzurot/test-utils` are the contract artifact; a producer guard (bot-client, `toMatchFileSnapshot`) + consumer derivation over the same fixture (ai-worker, PGLite) lock "given this `rawAssemblyInputs`, the worker assembles this context" — no cross-package import/mock (the structural block; council-reshaped). Locks the seam 2.5d deleted code against.
- Component tests for the worker `ContextAssembler` over PGLite — cross-channel decoration, reference enrichment, and content rewriting against real data remain mocked-only.
- Weigh-in assembly component test (recent message → included; empty → still assembles).
- ✅ `buildContext`-synthetic-anchor lock (#1283 — caught a real empty-channel weigh-in crash; proof the component-level test catches what buildContext-mocking unit tests structurally can't).

### Enforcement bulk — `test:tier-audit` ratchet ⏳

A registered audit-class tool (WHY.md + canary + baseline + drift-detect, per `docs/reference/audit-enforcement.md`) that measures whether each service/flow carries the tiers it should and **fails CI on regression** — the per-area gap matrix with a ratchet, building on the `test:tiers` classifier. The drift recurred because the model was docs-only (attention-based); this gives it teeth. (Seeds shipped in #1284; this is the bulk.)

### Resolved sub-decisions

- Suffix **rename** — ✅ DONE (#1339): `.int.test.ts`→`.component.test.ts`, `.e2e.test.ts`→`.integration.test.ts` / `.contract.test.ts`; `classifyTestFile` is now a pure suffix check (directory-location rule gone).
- `.schema.test.ts` adopt-or-drop — ✅ DROPPED (#1339): the `schema` file-kind is gone; a Zod schema test is a plain `*.test.ts` (unit-tier).

### PR B ✅ SHIPPED (#1340)

Golden-fixture flagship + a report-only coverage-topology skeleton (`coverageTopology.ts` + `pnpm ops topology:generate`, seeded with the locked context-assembly surface). Plan: `/home/deck/.claude/plans/floofy-rolling-crane.md`. **Next headline:** Phase 2 builds the full topology generator; the `test:tier-audit` ratchet is the enforcement bulk.

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
