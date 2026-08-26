---
id: TASK-673
title: >-
  Core Principle 9 has no mechanical trigger, and Stryker cannot substitute for
  it
status: To Do
assignee: []
created_date: '2026-08-19 02:44'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 673000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three assertions written in one session (2026-08-18/19, PRs 2146 and 2147) could not fail. All three were caught by manually mutating the code, none by reading the test, and none by CI.

The three, for shape: (a) a clamp test whose 4-char fixture could not discriminate the clamp from its absence, because slice() clamps a negative start to 0 once its magnitude exceeds the length; (b) a GITHUB_REF_NAME precedence test that still passed with the feature deleted, because a second guard produced the same outcome; (c) an alignment assertion using toContain, which is structurally blind to column position -- the property under test.

THE RULE ALREADY EXISTS. 02-code-standards.md Core Principle 9: "Prove a new assertion can fail - before trusting it, mutate the code it covers and confirm the test goes red; a test that passes either way reports coverage while verifying nothing." Read, known, and it did not fire three times. Per 00-critical Fix Recurring Failures Structurally that makes it a mechanism problem, not an attention problem.

WHY THE OBVIOUS ANSWER DOES NOT WORK -- measured, so it is not re-litigated:
- packages/tooling, where all three lived, is NOT in MUTATED_PACKAGES (config-resolver, cache-invalidation, conversation-history, identity, clients). The mutation-tests CI job went green on every one of those PRs because it never measured that package.
- Adding it wholesale is not viable. tooling is 39,001 source lines against a largest-tracked of 7,882 (clients) and 15,704 for all five tracked COMBINED. At the project measured ~0.35 mutants/line that is roughly 13,650 mutants, and 05-tooling.md already records services as not per-PR viable at 30-70min. tooling is larger than most services.
- EVEN IF IT WERE TRACKED, the gate would not have caught these. mutation-baseline.json scores per PACKAGE with a 1-point graceMargin, so three dead assertions in a 39k-line package cannot move the aggregate by a full point. Stryker as configured is a sampling net over a whole package, not a per-assertion gate. This is the important half: the intuition "more mutation coverage would have caught it" is directionally right and mechanically false.

LEADING FIX-SHAPE CANDIDATE, UNVERIFIED -- probe before designing: run Stryker scoped to the DIFF rather than the package. Stryker takes --mutate globs and has an incremental mode; if it can be pointed at only the source files a PR touches, the run is small, fast, and asks exactly the right question (did any mutant in the NEW code survive), which is Core Principle 9 automated. That sidesteps the 39k-line problem entirely because the whole package is never mutated. VERIFY the flag semantics against the installed Stryker before building on this -- it is a claim about an external tool and has not been probed.

Weaker fallback if that does not work: a hook that counts added expect( lines in staged *.test.ts and asks for confirmation. Note honestly that this is attention-dependent and that non-blocking post-hoc hook output does not reach the agent, so it is a much worse instrument than the diff-scoped run.

Sibling tasks, same family (a known rule with no mechanical trigger): TASK-669 (prose describing a removed mechanism), TASK-653 (numeric claims in a PR body), TASK-547 (completion claims), TASK-520 (external-system claims in comments). Read them before designing; a shared diff-inspection step may serve several.

Acceptance: adding an assertion that cannot fail is caught before merge by something other than the author remembering to check; the mechanism is demonstrated against at least one of the three real cases above rather than a synthetic one; if the diff-scoped Stryker run is the answer, its wall-clock cost on a typical PR is measured and stated.

PROBED 2026-08-26 — the leading candidate is VIABLE and better than this task assumed. Flags read off the installed binary (@stryker-mutator/core 10.0.0, packages/config-resolver/node_modules/.bin/stryker), not from docs or memory.

Do NOT probe this with `npx stryker` — npx resolves the ancient deprecated registry package `stryker` (not `@stryker-mutator/core`) and dies with "Cannot find module 'rx'". Run the package-local binary.

What the flags actually support:
- `-m, --mutate` takes a MUTATION RANGE, not merely a file glob: `src/index.js:startLine[:startColumn]-endLine[:endColumn]`. So a diff-scoped run can target the exact changed line ranges of a hunk, which is sharper than the file-level scoping this task hypothesized — an untouched function in a touched file is never mutated.
- `--allowEmpty` exits without error when nothing matches. That is the silent-pass property a gate needs for a diff with no mutable source; without it, a docs-only or test-only diff would fail the gate.
- `-t, --testFiles` limits which test files run, described upstream as verifying that a module's own unit tests kill its mutants independently.
- `--incremental` / `--incrementalFile` / `--force` exist as guessed.

MEASURED wall-clock, the acceptance's third clause: `stryker run --mutate 'src/SttResolver.ts:60-130' --allowEmpty` in packages/config-resolver produced 35 mutants over 71 lines in 8.1s real (34 killed, 1 survived — a `createLogger('SttResolver')` string literal, the known logger-noise class). Fixed overhead is about 4s: the same command over lines 1-40 (imports and types, ZERO mutants) took 4.2s. So roughly 4s startup plus ~4s for 35 mutants, at ~0.49 mutants/line of logic.

Projection: a PR touching ~200 lines of real source is ~100 mutants, comfortably under a minute. Against the 30-70min whole-package figure that blocked this task, diff-scoping is about two orders of magnitude cheaper, which moves it from not-per-PR-viable to plainly viable.

THE LIMIT OF THIS MEASUREMENT, stated because the number is tempting to over-read: it was taken in config-resolver, a small package that ALREADY has a stryker.config.mjs. The three defects this task exists for lived in packages/tooling, which has no Stryker config at all and carries 172 test files / 2857 tests. The ~4s floor is dominated by the initial dry run of the package's test suite, so it will NOT hold in tooling — measure there before promising a per-PR gate over that package. Adding a config to tooling is itself the 4-step onboarding in mutation-check.WHY.md § Onboarding, and the whole-package baseline problem does not go away just because the gate is diff-scoped.

Sibling-list correction: TASK-547 and TASK-520 have been Done since 2026-08-12; the list above predates that check. The live family is this task, TASK-669, and TASK-653.
<!-- SECTION:DESCRIPTION:END -->
