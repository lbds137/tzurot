---
id: TASK-201
title: Month-3 eval of the weekly audit + 45-day age-gate decision
status: To Do
assignee: []
created_date: '2026-07-03 00:00'
updated_date: '2026-09-04 19:35'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 201000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Month-3 eval of the weekly audit + 45-day age-gate decision

**Why:** The periodic-audit proposal's final steps: after ~3 months of weekly `ops health` runs (from ~2026-07), evaluate whether the reports are being read, prune always-green roster tools, and decide on the 45-day CI age-gate (age from GitHub Actions run history, not a file). Also revisit `TOOL_TIMEOUT_MS` (5min) × roster size vs the job's `timeout-minutes: 30` when growing the roster (PR #1466 round-5 review note). **Promote when**: ~2026-10, or when the roster next grows. Surfaced 2026-07-03.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:35
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Promote-when is "~2026-10, or when the roster next grows." Today is 2026-09-04 — the calendar trigger hasn't arrived yet, and no roster-growth eval was found in git history. Evidence: current date 2026-09-04 (< 2026-10); `git log --oneline --grep="ops health\|roster" -- packages/tooling` → no eval-shaped commit.
---
<!-- COMMENTS:END -->
