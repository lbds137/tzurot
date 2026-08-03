---
id: TASK-408
title: Rewrite BYOK_MANUAL_TESTING.md against the current command surface
status: Done
assignee: []
created_date: '2026-08-03 16:02'
updated_date: '2026-08-03 21:31'
labels:
  - 'area:docs'
  - 'size:S'
dependencies: []
priority: low
ordinal: 408000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: docs/reference/testing/BYOK_MANUAL_TESTING.md still scripts /model set-default, /model clear-default, and /admin llm-config-set-default flows. The /model command no longer exists (superseded by /preset) and the default-assignment surface is now /preset default set|clear — the doc cannot be executed as written. Surfaced by the TASK-405 rename sweep; confirmed independently by claude-review on PR #1915.
Fix shape: walk the doc against the live command tree (/preset, /settings apikey, /admin) and rewrite each step with the current command names and expected outputs. Needs current-BYOK-flow knowledge, not a string swap — which is why it did not ride the rename PR.
Acceptance: every command in the doc exists in command-manifest.json; the manual test pass is executable end-to-end as written.
<!-- SECTION:DESCRIPTION:END -->
