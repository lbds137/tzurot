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

### Phase 2 — Tzurot-wide tier audit (discovery) ⏳ NEXT

Inventory every service/flow against the 5 tiers; produce a per-area gap matrix (what tier is missing where). `test:audit` measures colocation, not tier coverage — this audit is behavioral. **Gated on a council pass to scope Phase 2/3 + the enforcement bulk before plan-mode** (per `06-backlog.md` "each substantial pick earns a council pass before plan-mode").

### Phase 3 — Gap-fill (the big undertaking) ⏳

- **Flagship**: a bot-client→worker envelope contract test (beside the BullMQ contract tests) locking "given this `rawAssemblyInputs`, the worker assembles this context" — the thing 2.5d deleted code against.
- Component tests for the worker `ContextAssembler` over PGLite — cross-channel decoration, reference enrichment, and content rewriting against real data remain mocked-only.
- Weigh-in assembly component test (recent message → included; empty → still assembles).
- ✅ `buildContext`-synthetic-anchor lock (#1283 — caught a real empty-channel weigh-in crash; proof the component-level test catches what buildContext-mocking unit tests structurally can't).

### Enforcement bulk — `test:tier-audit` ratchet ⏳

A registered audit-class tool (WHY.md + canary + baseline + drift-detect, per `docs/reference/audit-enforcement.md`) that measures whether each service/flow carries the tiers it should and **fails CI on regression** — the per-area gap matrix with a ratchet, building on the `test:tiers` classifier. The drift recurred because the model was docs-only (attention-based); this gives it teeth. (Seeds shipped in #1284; this is the bulk.)

### Resolved sub-decisions

- Suffix **rename** — ✅ DONE (#1339): `.int.test.ts`→`.component.test.ts`, `.e2e.test.ts`→`.integration.test.ts` / `.contract.test.ts`; `classifyTestFile` is now a pure suffix check (directory-location rule gone).
- `.schema.test.ts` adopt-or-drop — ✅ DROPPED (#1339): the `schema` file-kind is gone; a Zod schema test is a plain `*.test.ts` (unit-tier).

### Next: PR B (flagship + topology skeleton)

The council reframed Phase 2 (was "hand-authored tier-gap matrix") into a **code-derived coverage topology** — a generated registry of cross-service surfaces (route-manifest entries + BullMQ payload schemas) → required/actual tiers, lockfile-diffed in CI. PR B lands the flagship + a minimal skeleton; the full generator is Phase 2/discovery, the `test:tier-audit` ratchet is the enforcement bulk. Plan: `/home/deck/.claude/plans/floofy-rolling-crane.md`.

### Rename loose-ends — DO within this epic (not deferred to "someday")

Surfaced by #1339 claude-review; all direct consequences of the rename, so they close out as part of the epic — not cold/follow-ups trigger-gated items.

- [ ] **Trivial cleanup** (a quick PR, or fold into PR B): drop the dead `.component.test.ts` guards subsumed by the `.test.ts` check in `audit-unified.ts:70` + `scripts/audit-route-auth-matrix.ts:517` + `knip.json` (verify knip glob semantics first); and fix `audit-unified.ts:235` — its `findTestedSchemas` filters `.contract.test.ts` but `readdirSync` is non-recursive so that branch is dead (drop it, or make the scan recursive if contract-schema coverage should count). [#1339 introduced the `:235` dead branch.]
- [ ] **`ci.yml` "integration"→"component" naming** (its own careful PR): step label L344 (cosmetic), job name `integration-tests:` L290, Codecov `flags: integration` L362, coverage dir L361 + the coupled `reportsDirectory` in `vitest.component.config.ts`. **Coordinate**: the job name is likely a required branch-protection check (rename → update protection or the old name blocks merges forever); the flag rename resets Codecov trend history. `ci.yml` edits are safe on develop (claude-review lives in `claude-code-review.yml`). Either rename all four in sync (+ branch-protection update) or keep `flags: integration` as a stable label.
- [ ] **Rename `tests/e2e/` dir** (low priority): holds integration + contract, no real e2e; update `vitest.integration.config.ts` include glob + `audit-unified.ts` `e2eTestsDir`. Do when a true e2e test is added or during a `tests/` reorg.
