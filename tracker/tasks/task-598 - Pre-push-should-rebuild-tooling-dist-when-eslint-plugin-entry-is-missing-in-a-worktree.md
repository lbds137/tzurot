---
id: TASK-598
title: >-
  Pre-push should rebuild tooling dist when eslint plugin entry is missing in a
  worktree
status: To Do
assignee: []
created_date: '2026-08-14 00:40'
updated_date: '2026-08-14 12:18'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 598000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in a git worktree, the shared turbo cache restores an artifact set that lacks packages/tooling/dist/eslint/index.js, which the ROOT eslint.config.js imports. The pre-push hook then fails with ERR_MODULE_NOT_FOUND on that path, and the push is rejected after the full turbo run has already executed.

The failure is confusing because it names an eslint module error rather than a build problem, so the first read is "my lint is broken" rather than "my dist is incomplete". A pnpm-filter build does NOT reliably fix it - only `npx turbo run build --force --filter @tzurot/tooling` sticks.

RECURRENCE (this is why the priority moved to high for a size:S fix): 2 hits on 2026-08-13, then 3 more on 2026-08-14 across both active worktrees - 5 push cycles lost, each costing a rejected push plus a ~27s forced rebuild.

Sharper mechanism, measured 2026-08-14: the clobber is caused by the PRE-PUSH TURBO RUN ITSELF, not by some earlier unrelated restore. A direct `pnpm --filter @tzurot/tooling lint` succeeded minutes before each failure - so dist was complete at that point - and the pre-push turbo invocation then restored the incomplete cached artifact over it and immediately linted against the result. That means a "rebuild once at the start of the session" workaround cannot hold, and the check has to sit INSIDE the hook after any turbo step that can restore.

Fix shape: in .husky/pre-push, after the turbo build/lint step is set up but before eslint runs, test for packages/tooling/dist/eslint/index.js and run the forced tooling build when it is absent. Guard it on absence so the normal main-checkout path pays nothing. Emit one line naming WHY it is rebuilding, so the next person sees a build message instead of a module-resolution stack trace.

Acceptance: pushing from a worktree whose cache restore lacked the eslint dist succeeds without a manual rebuild; the main checkout path is unchanged and adds no measurable time. Probe the hook per the after-editing-any-hook rule.

Note: assistant-generated tooling-friction task - counts against the session net.
<!-- SECTION:DESCRIPTION:END -->
