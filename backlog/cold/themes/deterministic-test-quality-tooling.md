### Theme: Deterministic Test-Quality Tooling (mutation testing + job-payload contract)

_Focus: fill the remaining deterministic-gate rungs so seam/wiring bugs fail the build, not slip through green line-coverage. Sibling to the Production Observability theme below — both make the unsafe/invisible thing deterministic._

**Surfaced 2026-06-11 (user)** after the iii-b-2 thin-payload referenced-attachment regression (#1184): `jobChainOrchestrator` **had** a referenced-attachment test, and line coverage was green — but it covered only the _fat_ payload shape, so a new wire-shape shipped broken. Three green units, one broken cross-service seam. User's framing: unit tests are repeatedly insufficient for seam/wiring bugs; we want **deterministic checks that fail the build**. We already have strong gates (cpd ratchet, test-audit, depcruise, conformance harness, codecov) — this fills the remaining rungs.

**Candidates to evaluate (with honest scope of what each catches):**

1. **Mutation testing — StrykerJS** _(highest-leverage general tool)._ Line coverage measures code-_ran_, not bug-_caught_. Stryker mutates code (flip conditionals, delete statements, swap `??`/`&&`) and checks whether a test fails → grades test _effectiveness_. **Caveat**: catches weak tests, NOT missing code paths — it would not have caught #1184 directly, but it's the best deterministic answer to "are our tests a real net." Pilot on one package, set a mutation-score threshold, ratchet in CI like cpd/test-audit. **Recommended starting point.**
2. **Job-payload contract / property suite at the bot→gateway→worker BullMQ seam** _(targeted at the #1184 class)._ Assert every valid context shape (`legacy` / `envelope` / `envelope`+referenced-attachments) → correct job-chain → correctly consumed by the worker's pipeline. Consider **fast-check** (property-based). The rung that catches wire-shape regressions.
3. **Evaluate Pact (consumer-driven contracts)** — likely an awkward fit (internal BullMQ seam, not HTTP); quick rule-in/out.
4. **More compiler-enforced invariants** — the `ContextVariant` discriminated union (PR #1183) is the cheapest deterministic check; audit for more "make it unrepresentable" spots.

**Outcome**: decide what to adopt as CI ratchets (likely Stryker suite-wide floor + the job-payload contract test). **Method (REQUIRED)**: actual web research, not training-data priors — current tool maturity, latest versions, vitest/ESM integration, monorepo performance, and whether better alternatives have emerged all need live verification before any adoption decision.
