---
id: TASK-1272
title: >-
  removed-identifier-sweep precision: cap recall vs local consts, .md prose
  extraction, probe/doc riders
status: To Do
assignee: []
created_date: '2026-10-23 23:41'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1260000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the round-4 review on PR 2645 (none blocking, filed at merge). Core: the 40-identifier cap counts function-local consts BEFORE the code-hit skip, so a body-rewrite commit removing 40+ local consts prints sweep-skipped and drops the real exported removals in the same diff. Fix shape: restrict const/function extraction to column-0 or export declarations, or count after the skip; add the 41-local-consts + 1-exported-function probe case. Riders from the same review: shape_sed extracts declaration shapes from removed .md prose lines (a wrapped line starting with class names are extracts names) - add the silent-case probe or restrict shape_sed to code-extension hunks; probe header still says .claude/ excluded (now .claude/hooks/ and .husky/); hedge the git-grep-reads-worktree comment for the partial-stage case; document the cross-file same-name cancellation trade beside the cross-file-moves sentence; probe cases for excluded-path code hits and .claude/skills scope.
<!-- SECTION:DESCRIPTION:END -->
