---
id: TASK-598
title: >-
  Pre-push should rebuild tooling dist when eslint plugin entry is missing in a
  worktree
status: To Do
assignee: []
created_date: '2026-08-14 00:40'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 598000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in a git worktree, the shared turbo cache restores an artifact set that lacks packages/tooling/dist/eslint/index.js, which the ROOT eslint.config.js imports. The pre-push hook then fails with ERR_MODULE_NOT_FOUND on that path, and the push is rejected after the full turbo run has already executed. Hit twice in one session (2026-08-13), once per worktree, each costing a push cycle plus a 27s forced rebuild.

The failure is confusing because it names an eslint module error rather than a build problem, so the first read is "my lint is broken" rather than "my dist is incomplete". A pnpm-filter build does NOT reliably fix it - the next cache restore clobbers it again; only turbo run build --filter=@tzurot/tooling --force sticks.

Fix shape: in .husky/pre-push, before the turbo lint step, test for packages/tooling/dist/eslint/index.js and run the forced tooling build when it is absent. Guard it on absence so the normal main-checkout path pays nothing. Emit one line naming WHY it is rebuilding, so the next person sees a build message instead of a module-resolution stack trace.

Acceptance: pushing from a fresh worktree whose cache restore lacked the eslint dist succeeds without a manual rebuild; the main checkout path is unchanged and adds no measurable time. Probe the hook per the after-editing-any-hook rule.

Note: assistant-generated tooling-friction task - counts against the session net.
<!-- SECTION:DESCRIPTION:END -->
