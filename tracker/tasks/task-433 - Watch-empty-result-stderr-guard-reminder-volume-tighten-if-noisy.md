---
id: TASK-433
title: Watch empty-result-stderr-guard reminder volume; tighten if noisy
status: To Do
assignee: []
created_date: '2026-08-05 01:37'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 433000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review of the hook PR noted an accepted false-positive class — 2>/dev/null is also a check-and-ignore idiom where empty stdout is the CORRECT outcome (existence checks), and the hook cannot distinguish that from a swallowed failure because it reads no exit code. Accepted at ship time (reminder-only, one banner of cost).
Fix shape if it proves noisy: extract the exit code from the PostToolUse payload (if the field exists — probe first) and skip the reminder when the command exited non-zero, since a failing invocation already surfaces loudly via the Bash tool result; the deceptive case the hook exists for is exit 0 + empty stdout + discarded stderr.
Acceptance: either the hook stays as-is with observed-low noise, or the exit-code gate ships, or the hook is retired with the reason in the removing commit.
<!-- SECTION:DESCRIPTION:END -->
