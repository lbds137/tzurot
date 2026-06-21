# Theme: Test-Pyramid Taxonomy + Methodical Coverage Audit

_Focus: adopt one canonical testing-pyramid taxonomy across rules/skills/reference, reclassify our existing tests to it, then methodically audit Tzurot's coverage tier-by-tier and fill the gaps._

## Why this exists

Surfaced 2026-06-20 during the 2.5d Prisma-eviction epic. Two related problems:

1. **Taxonomy drift.** Our testing tiers are documented inconsistently across the three doc layers, and the always-loaded rules carry the thinnest model — which steered the whole 2.5d epic toward "add unit tests + lean on existing int tests" while the cross-service contract/integration tiers (where this epic's central risk lives) stayed off-radar. The thin taxonomy produced thin coverage.
2. **The 2.5d epic's load-bearing claim is unlocked.** Every slice deleted bot-client code on the argument "the worker re-derives identical context from the raw envelope." That was verified by code-reading + Explore agents + council, never by a standing test. It is fundamentally a **contract** between a producer (bot-client `rawAssemblyInputs`) and a consumer (worker `ContextAssembler`) — and we have no contract test for it.

## Canonical model — adopt Toby Clemson / Martin Fowler's microservice testing taxonomy

Five tiers (source below):

| Tier | Scope | Real vs. stubbed | Our file type today |
| --- | --- | --- | --- |
| **Unit** | one class / small group; business logic | all collaborators mocked (solitary) or real-but-observed (sociable) | `*.test.ts` ✅ strong |
| **Component** | one whole service in isolation; its DB is part of the unit | external *services* stubbed; datastore real (PGLite) | `*.int.test.ts` — **currently mislabeled "integration"** |
| **Integration** | a module against ONE real external dependency; verifies the communication path (protocol, serialization, error paths) | the external dep is real (or a faithful double) | thin — some `tests/e2e/*.e2e.test.ts` (real DB+Redis) |
| **Contract** | bilateral provider↔consumer agreement on a specific interface (consumer-driven) | neither full service booted — just the contract | `tests/e2e/contracts/BullMQJob{Producer,Consumer}.e2e.test.ts` — minimal |
| **E2E** | system as a black box; full deployed ecosystem; user journeys | everything real | effectively none |

A useful lens on which tier suits which kind of logic: **business/domain logic → unit (local, fast)**; **cross-boundary/application logic → contract + component (local) + integration with live deps**. Principle: don't over-mock cross-boundary logic — mocks there are brittle and sacrifice the encapsulation the test is supposed to protect; prefer live-dependency tests.

## The two "schema test" definitions — DISAMBIGUATE

The word "contract" is overloaded in our docs. Resolve to two distinct things:

- **Schema test** (`*.schema.test.ts`, Zod) — validates a single *type's own rules* (accepts/rejects the right inputs). This is a **structural/self-validation** test, effectively **unit-tier**. It is NOT a cross-service contract.
- **Contract test** (Clemson tier) — verifies *two services agree* on an interface (consumer-driven). The BullMQ producer/consumer pair is the only current example. Reserve the word "contract test" for THIS.

`.claude/rules/02-code-standards.md` currently files Zod schema tests under an "HTTP API contracts" heading, conflating the two. Fix: schema test = type-shape validation (unit-tier); contract test = cross-service agreement (its own tier).

## Phased roadmap

### Phase 1 — Reconcile the taxonomy (docs; foundational) ✅ DONE (PR #1284)
- ✅ Canonical `## Test Tier Taxonomy` section in `docs/reference/guides/TESTING.md` (5-tier model + business/application-logic lens), wrapped in a marked `<!-- canonical-test-tiers -->` block.
- ✅ Reclassified `*.int.test.ts` as **component** by re-documenting (kept the suffix; rename deferred to the epic per user 2026-06-20).
- ✅ Disambiguated schema vs. contract in `02-code-standards.md` + the `tzurot-testing` skill; the always-loaded rule now points at + one-line-summarizes the pyramid.
- ✅ Both enforcement seeds shipped (see Enforcement below).

### Phase 1.5 — Pilot: audit the 2.5d-touched surface (near-term, right after the doc PR)
Scope the FIRST audit to the code THIS Prisma-eviction epic changed — the highest-risk, freshest-context surface, and where the "worker re-derives what bot-client deleted" claim lives. Map each touched flow (routing-context, cross-channel, voice transcripts, participant-batch, weigh-in) to the 5 tiers and fill gaps in the right tier (e.g., the envelope contract test below). Doubles as a de-risking pilot of the audit METHODOLOGY on a bounded surface before the full Tzurot-wide Phase 2. **User directive 2026-06-20**: sequence this after the doc-reconciliation PR lands and before the broad audit; don't let it stall the active epic.

### Phase 2 — Tier audit (discovery; full Tzurot-wide)
- Inventory every service/flow against the 5 tiers; produce a per-area gap matrix (what tier is missing where). The `test:audit` tool measures colocation, not tier coverage — this audit is behavioral.

### Phase 3 — Gap-fill (the big undertaking)
- **Flagship**: a **bot-client → worker envelope contract test** (next to the BullMQ contract tests) that locks "given this `rawAssemblyInputs`, the worker assembles this context" — the thing 2.5d deleted code against. Highest leverage; a natural Phase-1.5 deliverable too.
- Component test for the worker's `ContextAssembler` re-derivation against PGLite (real data, not the mocked `dataSource` the current unit test uses; `AIJobProcessor.int` deliberately stubs assembly — un-stub or add beside).
- Weigh-in assembly component test (recent message → included; empty → still assembles) — locks the 2.5d slice-3+4 behavior change.
- ✅ `buildContext`-with-synthetic-anchor lock — **DONE in PR #1283**. Immediately caught a real bug: the synthetic anchor was missing `mentions.users`, which would have crashed an empty-channel weigh-in. Proof that the component-level (real-builder) test catches what buildContext-mocking unit tests structurally can't.

## Enforcement — the taxonomy must be mechanically enforced, not just documented

The drift recurred *because* it was docs-only (attention-based). Per `00-critical.md` "Fix Recurring Failures Structurally" (rules → skills → hooks), the model has to be enforced or it re-rots. The **bulk** of the mechanism lands in the big epic; the **seed** lands in the interim doc-reconciliation PR (user directive 2026-06-20: "some mechanism for enforcement, even if the bulk lands later").

**Bulk (big epic) — the real teeth:** a `pnpm ops test:tier-audit` registered audit-class tool (WHY.md + canary + baseline + drift-detect, per `docs/reference/audit-enforcement.md`) that measures whether each service/flow carries the tiers it should and **fails CI on regression**. This is the per-area tier-coverage gap matrix with a ratchet — distinct from `test:audit`, which measures colocation, not tier coverage.

**Seed (doc PR) — both shipped in PR #1284:**
1. ✅ **`guard:test-taxonomy`** — anti-drift binary sync-check (the `guard:duplicate-exports` class, NOT audit-class). Fails CI if `TESTING.md` drops a canonical tier or if the rule/skill stop linking to the canonical block. Ties the doc to `CANONICAL_TEST_TIERS` (`packages/tooling/src/test/test-tiers.ts`). Wired into CI lint job + `pnpm quality`. **Known scope limit** (reviewer-accepted, not fixed): it checks pointer-presence, not anchor-validity — a `## Test Tier Taxonomy` heading rename would 404 the anchor while the guard stays green. Cheap to harden in the epic if it ever bites.
2. ✅ **`test:tiers`** — report-only per-package tier distribution (`packages/tooling/src/test/tier-report.ts`). No gate. Shares the `test-tiers.ts` classifier kernel with the guard. The bulk `test:tier-audit` ratchet builds on this.

Decided: keep `*.int.test.ts` / `*.e2e.test.ts` + re-document (done). A suffix **rename** (`*.component.test.ts` etc.) is revisited in the epic — disruptive (touches every int test + runner config), only if the tier report shows it's worth it.

**Surfaced by `test:tiers` on first run** (filed to `cold/follow-ups.md`): **0** `*.schema.test.ts` files exist repo-wide — every schema test is a colocated `*.test.ts` (unit-tier). The `.schema.test.ts` suffix is documented + recognized by the classifier but unused. Adopt-or-drop decision deferred to Phase 2.

## Sources

- Toby Clemson, "Testing Strategies in a Microservice Architecture," martinfowler.com (2014) — the canonical 5-tier taxonomy this theme adopts.

## Status

Filed 2026-06-20. Foundational understanding captured here so it isn't lost; the active epic (2.5d) stays the focus. **Near-term sequence (user-directed 2026-06-20):** (1) ✅ merge PR #1283 → (2) ✅ interim "stop-the-bleeding" doc-reconciliation PR (Phase 1, **PR #1284, merged 2026-06-21**) → (3) **NEXT: Phase 1.5 pilot audit** of the 2.5d-touched code → (4) finish the 2.5d epic (full `getChannelHistory` eviction + Phase 4). The full Tzurot-wide Phase 2/3 promotes to Active Epic later, with a council pass on scope first.
