---
id: TASK-655
title: Stryker 10 major bump needs its own PR plus a baseline refresh
status: To Do
assignee: []
created_date: '2026-08-18 10:55'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 655000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dependabot PR 2137 (dev-deps group, 20 updates) is RED on mutation-tests. config-resolver scored 85.97 against floor 86.17 (baseline 87.17), 77 undetected mutants. The cause is not a test-quality regression — the same PR bumps @stryker-mutator/api, /core and /vitest-runner from 9.6.1 to 10.0.0. A Stryker major changes which mutants are generated, so the score is measured against a different mutant population than the baseline was.

That makes this the sanctioned mutation:update-baseline case rather than the close-the-gaps case (05-tooling distinguishes them: never hand-edit a baseline on a genuine drop, but a measurement-basis change is different). The refresh requires a fresh LOCAL Stryker report for EVERY tracked package in MUTATED_PACKAGES, and heavy local test runs are the known OOM risk on this machine — the CI job runs all packages in about 4.5 minutes, so locally it is plausible but wants care.

Why separate from 2137: bundling a major test-infrastructure upgrade with 19 unrelated dev-dep bumps means the baseline refresh rides a PR nobody would review as an infrastructure change, and a red ratchet is the only thing currently making it visible.

Also unread: Stryker 10 breaking changes. Its config surface may have changed; the ratchet reads reports/mutation/<pkg>/ and mutation-check.ts compiles per-package config, so a format change would surface as a confusing failure rather than a clean one. Read the v10 migration notes before running anything.

Fix shape: take Stryker 10 as its own branch, read the v10 breaking changes, run test:mutation for every tracked package locally, run mutation:update-baseline, and land it with the score deltas stated per package in the PR body so the new numbers are a recorded decision rather than a silent ratchet move. Then let dependabot re-open the remaining dev-deps group.

Acceptance: Stryker 10 on develop, mutation:check green, and the PR body names each tracked package old score to new score with the mutant-population change as the stated reason.

## GROUNDING 2026-08-19 (read-only) — the cause has a name, and it changes the framing

Read the canonical changelog (packages/core/CHANGELOG.md on master), not just
the release page, which loads partially.

v10.0.0 documents exactly ONE breaking change: "Node.js 20 is no longer
supported, please use Node.js 22 or higher." This machine runs Node 24, so the
upgrade is unblocked on that axis. Nothing in the changelog describes a config,
reporter, or JSON-output change, so the concern above about the ratchet reading
reports/mutation/<pkg>/ in a changed format is NOT supported by the notes —
still verify against a real report before trusting it, but do not plan for it.

THE MUTANT-POPULATION CHANGE HAS A NAMED CAUSE. v10 adds an
`empty-expression-mutator` (#6012). That is the concrete mechanism behind
config-resolver's 85.97: a new mutator enlarges the population, and every one of
its mutants our tests fail to kill pushes the ratio down. The premise above
("a Stryker major changes which mutants are generated") is therefore confirmed
rather than assumed.

WHAT THAT REFRAMES. "Measurement-basis change, so refresh the baseline" is
still correct — the denominator genuinely moved. But the 77 undetected mutants
are not a neutral artifact: they are real gaps the OLD Stryker could not see,
newly made visible. So the refresh is the floor of the work, not the whole of
it. Before accepting the new numbers, look at what the empty-expression mutants
actually are in config-resolver; if a cluster of them is trivially killable,
closing those is the most-correct move and the baseline lands higher.

Practical note: all five tracked packages are small (config-resolver,
cache-invalidation, conversation-history, identity, clients) — no service is
tracked — so the local-OOM risk flagged above is lower than the general warning
implies. NOT started; no code written, no dependency bumped.
<!-- SECTION:DESCRIPTION:END -->
