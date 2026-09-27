---
id: TASK-1134
title: >-
  Dedup the vendored .claude/hooks/lib/shell_quotes.py against the harness
  plugin's lib/shell_quotes.py
status: To Do
assignee: []
created_date: '2026-09-27 19:47'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1126000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: harness 0.3.12 (claude-harness main d760527) reworked its shared lib/shell_quotes.py (command_pipelines, unwrap_runners, comments and ANSI-C quoted strings, trap/watch/eval wrappers, fd-3 transport). Tzurot's vendored copy at .claude/hooks/lib/shell_quotes.py is now behind, so Tzurot's guards tokenize commands differently from the harness guards, and several open guard false-positive/evasion tasks (TASK-879, TASK-1048, TASK-862) may already be fixed upstream.

What: diff the two copies, then either import the harness copy from Tzurot's hooks or re-vendor it, and re-run every hook probe (guard:hook-probes). Close any open guard task the upstream change already fixes, with the probe as evidence.

Acceptance: one shell_quotes implementation (or a vendored copy byte-identical to the harness one with a sync check); guard:hook-probes green.
<!-- SECTION:DESCRIPTION:END -->
