# Why `test:audit` exists

## What it does

Unified test-coverage audit covering two categories:

- **Services**: every `*.service.ts` (and Prisma-using class) should have an integration test
- **Contracts**: every Zod schema in `common-types/src/schemas/` and route handler should have a contract test

Auto-detects Prisma usage (no manual exempt list) and ratchets findings against `.github/baselines/test-coverage-baseline.json`. CI fails on NEW gaps beyond the baseline; existing pre-baseline gaps are grandfathered.

`--strict` fails on ANY gap (not just new ones). `--update` writes the current state to the baseline (used after a coverage push). `--category <cat>` runs only services or contracts.

Two deprecated aliases (`test:audit-contracts`, `test:audit-services`) exist for backward compatibility; both delegate to `auditUnified` with the appropriate `--category` filter.

## Why it was built

Coverage tools (codecov, vitest) measure line-level coverage of files that have ANY tests — they're silent on files that have NO tests at all. The blind spot: a contributor adds a new `*.service.ts` and no test for it; line coverage on the file is `0%`, but the file isn't flagged because codecov's view is "what % of THIS file is covered" not "is this file covered at all."

The ratchet pattern (file-level coverage baseline that can only go down, not up) was needed because:

1. The project has historical files without tests (pre-baseline tech debt)
2. CI shouldn't block PRs over pre-existing gaps the contributor didn't create
3. But new gaps MUST be caught — adding a new `*.service.ts` without a test should fail the PR

`test:audit` is the structural enforcement that converts "test culture" into a CI gate. `.claude/rules/00-critical.md` "NEVER add NEW code to `knownGaps` baseline — write proper tests instead" is the explicit no-bypass rule.

## Drift detection (Layer 3)

`test:audit` hard-fails when the baseline's stored `meta.configHash` doesn't match the current config fingerprint. The fingerprint hashes `{ implVersion: TEST_AUDIT_IMPL_VERSION }` — bumped whenever the measurement-affecting logic changes (Prisma-detection heuristic, service-file glob, Zod schema enumeration, audit-ignore comment shape). A bump invalidates existing baselines and forces an explicit `test:audit --update` refresh. Without this, a heuristic change silently makes every subsequent ratchet check meaningless — the `knownGaps` baseline was captured under different rules than the current scan.

The drift check is skipped in `--update` mode (that path REFRESHES the meta block; failing there would be circular).

## Threshold rationale

The baseline is in `.github/baselines/test-coverage-baseline.json` and tracks known-gap files explicitly. The intent:

- New files default to "must have a test"
- Existing files in the baseline can stay without tests (grandfathered)
- Any addition to the baseline requires a deliberate justification

`--strict` flips the default to "every file must have a test," used for occasional cleanup passes that close pre-baseline gaps.

The Prisma auto-detection is heuristic: `hasPrismaUsage()` greps for `getPrismaClient()` and similar import patterns. False positives are possible but rare; false negatives (Prisma access that the heuristic misses) are mitigated by the contract-category check covering the same files from a different angle.

## Decay check

When this tool's reminder fires:

- Did the project move to a different test framework that enforces per-file coverage natively? The audit becomes redundant.
- Is the baseline growing unbounded? That's a smell — the no-add rule is being violated. Investigate.
- Has every file in the codebase been covered? Delete the baseline file and run with `--strict` permanently.
- Are the Prisma-detection heuristics producing false positives? Refine `hasPrismaUsage()`.

The audit's value is hardest to assess when it's doing its job — quiet CI means no new gaps slipped through. Don't delete the tool just because its output is "no new gaps this round."
