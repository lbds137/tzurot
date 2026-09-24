---
id: TASK-1081
title: Wire shellcheck -s sh into the hook-posix-parse CI job
status: To Do
assignee: []
created_date: '2026-09-24 14:11'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1074000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the hook-posix-parse job (TASK-1073, PR 2506) runs sh -n under dash, which catches parse-level bashisms only. A semantic bashism parses fine and misbehaves silently: [ a == b ] makes dash print unexpected operator and return 2, which an if treats as false (wrong branch, no failed hook). The cloud VM is the one environment that runs the hooks under dash, so a miss there is silent. claude-review raised it on PR 2506. The cloud run showed shellcheck 0.9.0 cannot parse the repo directive style "# shellcheck disable=SC2086 -- reason" in .husky/pre-push (SC1073/SC1072), so wiring shellcheck in CI first needs those directives rewritten to a form shellcheck accepts, keeping a stated reason.
Fix shape: rewrite the hook shellcheck directives, then add shellcheck -s sh over .husky/pre-commit, .husky/pre-push and .husky/commit-msg to hook-posix-parse. Check the runner shellcheck version first; not verified whether ubuntu-latest ships it.
Acceptance: the job runs shellcheck and goes red on a canary [ a == b ] added to a hook.
<!-- SECTION:DESCRIPTION:END -->
