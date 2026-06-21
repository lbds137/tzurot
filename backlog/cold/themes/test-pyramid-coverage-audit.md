# Theme: Test-Pyramid Taxonomy + Methodical Coverage Audit

_Focus: adopt one canonical testing-pyramid taxonomy across rules/skills/reference, reclassify our existing tests to it, then methodically audit Tzurot's coverage tier-by-tier and fill the gaps._

## Why this exists

Surfaced 2026-06-20 during the 2.5d Prisma-eviction epic. Two related problems:

1. **Taxonomy drift.** Our testing tiers are documented inconsistently across the three doc layers, and the always-loaded rules carry the thinnest model — which steered the whole 2.5d epic toward "add unit tests + lean on existing int tests" while the cross-service contract/integration tiers (where this epic's central risk lives) stayed off-radar. The thin taxonomy produced thin coverage.
2. **The 2.5d epic's load-bearing claim is unlocked.** Every slice deleted bot-client code on the argument "the worker re-derives identical context from the raw envelope." That was verified by code-reading + Explore agents + council, never by a standing test. It is fundamentally a **contract** between a producer (bot-client `rawAssemblyInputs`) and a consumer (worker `ContextAssembler`) — and we have no contract test for it.

## Canonical model — adopt Toby Clemson / Martin Fowler's microservice testing taxonomy

(Capital One's published approach builds on this; sources below.) Five tiers:

| Tier | Scope | Real vs. stubbed | Our file type today |
| --- | --- | --- | --- |
| **Unit** | one class / small group; business logic | all collaborators mocked (solitary) or real-but-observed (sociable) | `*.test.ts` ✅ strong |
| **Component** | one whole service in isolation; its DB is part of the unit | external *services* stubbed; datastore real (PGLite) | `*.int.test.ts` — **currently mislabeled "integration"** |
| **Integration** | a module against ONE real external dependency; verifies the communication path (protocol, serialization, error paths) | the external dep is real (or a faithful double) | thin — some `tests/e2e/*.e2e.test.ts` (real DB+Redis) |
| **Contract** | bilateral provider↔consumer agreement on a specific interface (consumer-driven) | neither full service booted — just the contract | `tests/e2e/contracts/BullMQJob{Producer,Consumer}.e2e.test.ts` — minimal |
| **E2E** | system as a black box; full deployed ecosystem; user journeys | everything real | effectively none |

Capital One overlay: **business logic → unit (local, fast)**; **application logic → contract + component-with-mocks (local) + integration/QA env (live deps)**. Principle: don't over-mock application logic (brittle) — prefer live-dependency tests in an integration environment.

## The two "schema test" definitions — DISAMBIGUATE

The word "contract" is overloaded in our docs. Resolve to two distinct things:

- **Schema test** (`*.schema.test.ts`, Zod) — validates a single *type's own rules* (accepts/rejects the right inputs). This is a **structural/self-validation** test, effectively **unit-tier**. It is NOT a cross-service contract.
- **Contract test** (Clemson tier) — verifies *two services agree* on an interface (consumer-driven). The BullMQ producer/consumer pair is the only current example. Reserve the word "contract test" for THIS.

`.claude/rules/02-code-standards.md` currently files Zod schema tests under an "HTTP API contracts" heading, conflating the two. Fix: schema test = type-shape validation (unit-tier); contract test = cross-service agreement (its own tier).

## Phased roadmap

### Phase 1 — Reconcile the taxonomy (docs; foundational)
- One canonical pyramid section in `docs/reference/guides/TESTING.md` using the 5-tier model above + the Capital One business/application-logic overlay.
- Reclassify `*.int.test.ts` as **component** (concept rename; file-suffix rename is optional and disruptive — decide).
- Disambiguate schema vs. contract in `02-code-standards.md` + the `tzurot-testing` skill, and make the always-loaded rule *point at and one-line-summarize* the pyramid so the cross-service tiers are top-of-mind.
- Rules/skills are review-gated (PR); `docs/` + this theme can go direct.

### Phase 2 — Tier audit (discovery)
- Inventory every service/flow against the 5 tiers; produce a per-area gap matrix (what tier is missing where). The `test:audit` tool measures colocation, not tier coverage — this audit is behavioral.

### Phase 3 — Gap-fill (the big undertaking)
- **Flagship**: a **bot-client → worker envelope contract test** (next to the BullMQ contract tests) that locks "given this `rawAssemblyInputs`, the worker assembles this context" — the thing 2.5d deleted code against. Highest leverage.
- Component test for the worker's `ContextAssembler` re-derivation against PGLite (real data, not the mocked `dataSource` the current unit test uses; `AIJobProcessor.int` deliberately stubs assembly — un-stub or add beside).
- Weigh-in assembly component test (recent message → included; empty → still assembles) — locks the 2.5d slice-3+4 behavior change.
- `buildContext`-with-synthetic-anchor unit lock (the field-only contract left unlocked in PR #1283).

## Sources

- Toby Clemson, "Testing Strategies in a Microservice Architecture," martinfowler.com (2014) — the 5-tier taxonomy.
- Capital One Tech, "Design for testing Part 2: Business vs. application logic" — the business/application-logic overlay + what to run locally vs. in integration/QA.

## Status

Filed 2026-06-20. Foundational understanding captured here so it isn't lost; the active epic (2.5d) stays the focus. Promote to Active Epic after 2.5d + Phase 4 close, with a council pass on scope first.
