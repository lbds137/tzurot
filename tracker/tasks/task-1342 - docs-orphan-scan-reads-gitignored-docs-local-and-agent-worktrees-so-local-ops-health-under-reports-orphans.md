---
id: TASK-1342
title: >-
  docs-orphan-scan reads gitignored docs/local and agent worktrees, so local ops
  health under-reports orphans
status: To Do
assignee: []
created_date: '2026-11-02T20:04:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1325000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: scanDocsOrphans builds its haystack with findMarkdownFiles(repoRoot), which skips only node_modules, .git, dist, coverage and .turbo (packages/tooling/src/audits/docs-orphan-scan.ts, grep findMarkdownFiles). On a machine with docs/local or .claude/worktrees, those files count as inbound mentions. A worktree is a full checkout, so its copy of a doc can rescue that same doc, and ops health is run on the Deck, where worktrees exist. Found by claude-review on the TASK-1186 PR; the behaviour is by code reading, not measured. What: exclude gitignored paths, by scanning git ls-files or adding both prefixes. Acceptance: a doc mentioned only under docs/local or .claude/worktrees is reported as an orphan, with a test.
<!-- SECTION:DESCRIPTION:END -->
