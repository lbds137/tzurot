# Why `mutation:check` exists

## What

A per-package mutation-score ratchet over StrykerJS reports. CI runs Stryker
on the tracked packages (`pnpm --filter @tzurot/<pkg> test:mutation` →
`reports/mutation/<pkg>/mutation.json`), then `pnpm ops mutation:check`
computes each package's mutation score (Killed+Timeout over
detected+undetected; Ignored and invalid mutants excluded) and fails when a
score drops below its baseline floor (`baseline.score − graceMargin`).
`pnpm ops mutation:update-baseline` is the sanctioned refresh path.

## Why

Line coverage measures code-_ran_, not bug-_caught_ — the theme-founding
incident (#1184) shipped a broken cross-service seam through three green,
fully-covered unit suites. Mutation testing is the deterministic answer to
"are these tests a real net": each surviving mutant is a behavior change no
test noticed. The config-resolver pilot proved the gap concretely: 60.71%
initial score against green line coverage, with 73 real logic-class assertion
gaps (cascade-tier guards, Prisma seam shapes, caching semantics) that
gap-closing tests then eliminated. Without a ratchet, that recovered ground
erodes silently as new code lands with weak tests.

## Threshold rationale

Baseline-and-hold at the **measured** score, not a round-number floor. The
tuned score (logger-call mutants ignored via the `logger-calls` Stryker
plugin) sits in the mid-90s; an aspirational "80%" gate would tolerate ~15
points of silent regression — dozens of new untested branches — before CI
noticed. The per-package `graceMargin` (default 1 score point) exists solely
to absorb equivalent-mutant borderline noise: at the current mutant
population, one mutant is worth ~0.3 points, so the margin allows ~3
borderline mutants of slack and nothing more. Raising a floor happens by
writing better tests and refreshing; lowering one requires the explicit
`mutation:update-baseline` path, which is visible in review.

## Decay check

Three failure modes, three detectors. (1) **Tool rot**: the canary fixture
(`test-fixtures/audit-canaries/mutation-check/`) is a deliberately
below-floor report + baseline; the canary test asserts `status: 'fail'` with
findings > 0, so a dep bump that breaks report parsing or score arithmetic
turns CI red. (2) **Config drift**: the baseline carries a `configHash` over
`getMutationConfigFingerprint()` (impl version, expected ignorers, tracked
packages) — changing what the score measures without refreshing the baseline
hard-fails. Bump `MUTATION_IMPL_VERSION` when the arithmetic or bucketing
changes. (3) **Silent skips**: a tracked package with no report is a
failure, never a pass — the gate cannot be discharged by not running Stryker.
