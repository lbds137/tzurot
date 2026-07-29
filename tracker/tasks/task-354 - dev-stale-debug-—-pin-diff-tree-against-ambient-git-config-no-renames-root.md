---
id: TASK-354
title: >-
  dev:stale-debug — pin diff-tree against ambient git config (--no-renames,
  --root)
status: To Do
assignee: []
created_date: '2026-07-29 18:14'
labels:
  - 'size:S'
dependencies: []
priority: low
ordinal: 354000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #1861 round-4 review (merged via the round-cap merge-as-is path with this filed). Two low-severity hardening items on selectAddingCommits' diff-tree call: (a) without --no-renames, an environment with diff.renames=true makes a renaming debug commit emit a rename-descriptor path ("{old => new}.ts") that blame then fails on and isMissingPathError silently swallows — a false negative dependent on ambient git config; (b) without --root, a parentless (repo-root) debug commit diffs as empty — theoretical here (the debug convention postdates the initial commit by years).
Fix shape: add --no-renames (and optionally --root) to the diff-tree invocation in packages/tooling/src/dev/stale-debug-audit.ts selectAddingCommits + a unit test pinning the flags crossing the runGit seam; drop or annotate the WHY.md rename-limitation paragraph's "one step earlier" gap accordingly.
<!-- SECTION:DESCRIPTION:END -->
