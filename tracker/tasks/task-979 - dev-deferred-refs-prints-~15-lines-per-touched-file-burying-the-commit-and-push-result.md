---
id: TASK-979
title: >-
  dev:deferred-refs prints ~15 lines per touched file, burying the commit and
  push result
status: Done
assignee: []
created_date: '2026-09-14 18:14'
updated_date: '2026-09-25 15:23'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 975000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the hook prints every tracker task that mentions each touched file, with no cap. Measured 2026-09-14: 45 lines for a 3-file set, 11 tasks listed for packages/tooling/src/commands/secrets.ts alone, and ~90 lines on a 7-file push. The ref-update line of git push and the commit summary land AFTER that wall, so the one line that says whether the operation succeeded is the hardest line to find.

The cost is not cosmetic. It is the standing pressure to pipe git commit and git push through tail or grep, which lossy-pipe-guard.sh exists to block because that shape has swallowed hook rejections and reported pushes that never landed. That guard fired FOUR times in one session (2026-09-14, the PR 2427 review rounds) against the same operator, who has a memory note about the rule. A guard that has to fire four times per session is fighting an ergonomic cause it cannot remove.

Fix shape: cap the per-file list (top 3 by recency or relevance, then "and N more - run pnpm ops dev:deferred-refs <file> for the rest"), or collapse to one line per file naming the count, or suppress entirely when the touched set exceeds ~3 files since a 90-line reminder is not read anyway. The signal worth keeping is "this file has deferred work"; the enumeration is what nobody reads. packages/tooling/src/dev/ owns the command; it is wired into .husky/pre-commit and .husky/pre-push.

Acceptance: a 7-file commit prints no more than ~15 lines of deferred-ref output; the commit summary and the push ref-update line are visible without scrolling; the per-file detail stays reachable on demand.
<!-- SECTION:DESCRIPTION:END -->
