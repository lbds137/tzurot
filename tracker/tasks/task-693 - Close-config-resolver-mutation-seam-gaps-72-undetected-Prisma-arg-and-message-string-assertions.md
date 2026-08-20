---
id: TASK-693
title: >-
  Close config-resolver mutation seam gaps (72 undetected: Prisma-arg and
  message-string assertions)
status: To Do
assignee: []
created_date: '2026-08-20 03:01'
labels:
  - 'area:config-resolver'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 693000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the Stryker 10 bump (TASK-655) measured config-resolver at 86.89 vs the July baseline 87.17. The v10 population change accounts for almost none of it - the measured mechanism (v9-vs-v10 report diff, 2026-08-19): v10 added 56 mutants (39 Ignored / 13 Killed / 4 undetected, all four killed by new tests in the bump PR), zero status flips - and v9 on TODAY code already scored 86.15, meaning ~1 point decayed since July from code added without mutant-killing tests. The CI mutation:gate skips runs for PRs that cannot move a tracked score, so the decay accumulated unmeasured.

What: 68 Survived + 4 NoCoverage remain (v10 report reports/mutation/config-resolver/mutation.json, regenerable via pnpm --filter @tzurot/config-resolver test:mutation). Dominant classes: ObjectLiteral -> {} on Prisma query args (37) - where/select objects mutated to {} survive because tests mock prisma.*.findFirst to return fixtures regardless of arguments (the mock-seam blindness of 02-code-standards rule 7); StringLiteral -> empty (22) on messages and cache keys. By file: VisionConfigResolver 26, LlmConfigResolver 20, TtsConfigResolver 19, ConfigCascadeResolver 6, SttResolver 4, BaseConfigResolver 2 (pre-bump-PR counts).

Fix shape: per-file pass adding seam assertions (toHaveBeenCalledWith on the where/select crossing the mocked prisma boundary) and message/key pins where they carry behavior. Judgment per mutant: some StringLiteral survivors are log-message text not worth pinning - the ignorer plugin may be the right home for those instead.

Acceptance: config-resolver score at or above its July level (87.17) with no baseline grace consumed, or each remaining survivor class explicitly dispositioned (test added / ignorer extended / recorded as not-worth-pinning).
<!-- SECTION:DESCRIPTION:END -->
