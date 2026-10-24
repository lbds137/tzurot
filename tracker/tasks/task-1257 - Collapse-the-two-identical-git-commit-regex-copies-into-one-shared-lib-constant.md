---
id: TASK-1257
title: >-
  Collapse the two identical git-commit regex copies into one shared-lib
  constant
status: Done
assignee: []
created_date: '2026-10-19 09:21'
updated_date: '2026-10-24 16:07'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1245000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after TASK-1106 retired lossy-pipe-guard, the commit-detection pattern lives as two byte-identical literals (board-commit-branch-gate.sh COMMIT_RE and the re.search in develop-code-commit-guard.sh), kept in step by gitCommitPatternAgreement.test.ts text extraction. Both hooks already import .claude/hooks/lib/shell_quotes.py, so the original reason for separate copies (each needs its own stripping) no longer holds (PR 2637 review round 3).

What: export one GIT_COMMIT_RE from the shared lib (or a small lib/git_commit.py), import it in both hooks, delete the extraction machinery and the cmd-parameter-name and one-line constraints it imposes in develop-code-commit-guard.sh, and turn the agreement test into a plain case-table test of the shared constant.

Acceptance: one pattern definition; both hook probes and the case table green; no text-extraction test remains for this pattern.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Also from PR 2637 review round 5: until the collapse lands, the test name and comments hardcode two copies, and new Set(patterns).size === 1 passes vacuously with one source; when rewriting, either the shared constant removes this or assert SOURCES.length >= 2.
<!-- SECTION:NOTES:END -->
