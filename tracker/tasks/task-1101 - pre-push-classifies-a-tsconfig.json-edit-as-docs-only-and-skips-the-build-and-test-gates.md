---
id: TASK-1101
title: >-
  pre-push classifies a tsconfig.json edit as docs-only and skips the build and
  test gates
status: To Do
assignee: []
created_date: '2026-09-25 13:43'
labels:
  - 'area:husky'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1094000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on the TASK-984 push (chore/task-984-tooling-dist-test-exclusion, 2026-09-25) the only changed file was packages/tooling/tsconfig.json, and .husky/pre-push printed "Docs-only push detected - running line-budget and backlog checks" then "Only documentation/config files changed - skipping build and tests". A tsconfig edit changes what the build emits (this one dropped 229 files from dist) and what typecheck covers, so the one gate that would observe the change is the one the classifier skipped. CI caught nothing here only because the Deck ran the build, the tooling suite and pnpm quality by hand before the push; the hook itself would have let a broken exclusion through to CI.
Fix shape: read the docs-only classifier in .husky/pre-push (grep "Docs-only push detected"); carve build-affecting config out of the docs class: tsconfig*.json, turbo.json, package.json, pnpm-workspace.yaml, .npmrc, vitest*.config.*, eslint.config.js, .dependency-cruiser.cjs, and Dockerfiles. Those run the full gate. Keep markdown, tracker, backlog and the JSON baselines under .github/baselines in the docs class. Add a probe under .claude/hooks or the husky probe set that feeds a tsconfig-only diff and asserts the full path is taken (guard:hook-probes registry).
Acceptance: a push whose only change is a tsconfig.json runs the turbo build and test step; a push whose only change is a tracker task file still takes the docs-only path; the probe pins both.
<!-- SECTION:DESCRIPTION:END -->
