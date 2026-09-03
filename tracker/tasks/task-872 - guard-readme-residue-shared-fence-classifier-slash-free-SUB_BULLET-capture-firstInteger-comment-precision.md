---
id: TASK-872
title: >-
  guard:readme residue - shared fence classifier, slash-free SUB_BULLET capture,
  firstInteger comment precision
status: Done
assignee: []
created_date: '2026-09-02 23:53'
updated_date: '2026-09-03 12:15'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 872000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: round-5 review residue on #2308 (guard:readme), all low, filed rather than run as a sixth round. (1) stripFencedBlocks and extractFencedPnpmCommands in packages/tooling/src/dev/check-readme-classes.ts each keep their own inFence state machine and fence-delimiter test; teaching one about ~~~ fences or indented code blocks would silently leave the other behind, and no test spans both. (2) SUB_BULLET (/^\s+-\s+`([^`]+)\/`/) captures across an embedded slash, so a hypothetical nested entry `foo/bar/` mis-parses as foo/bar instead of failing to match. (3) the firstInteger comment says a compound engines range mis-reads as the first integer; be precise that the mis-read is silent (no finding) even when the effective minimum differs.

Fix shape: one classifyLines(readme) helper returning { line, fenced, tag } that both consumers read; anchor the SUB_BULLET capture to [^`/]+; one clause on the firstInteger comment. Colocated tests: a fixture with a ~~~ fence exercised through BOTH consumers, and a nested-path sub-bullet that falls into the on-disk-but-not-listed finding. size:S, one file plus its test.

Acceptance: both fence consumers read the same classification (one fixture proves it), the nested sub-bullet no longer mis-captures, guard:readme stays green on the real README.
<!-- SECTION:DESCRIPTION:END -->
