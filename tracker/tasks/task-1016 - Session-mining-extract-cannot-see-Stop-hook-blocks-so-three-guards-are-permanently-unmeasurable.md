---
id: TASK-1016
title: >-
  Session-mining extract cannot see Stop-hook blocks, so three guards are
  permanently unmeasurable
status: To Do
assignee: []
created_date: '2026-09-18 16:19'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1012000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the agent-lens extract in /tzurot-session-mining Step 1b captures only PreToolUse blocks (tool_result is_error). Stop-hook and UserPromptSubmit-hook outputs (turn-end-shape-gate, promise-ledger-check, blocking-question-channel-check, plus the husky claim-shape guard that exits 0) never appear, so three miners in the 2026-09-18 run logged them as 0 trips when they are unmeasurable, and they can never reach the 3-window zero the retirement question needs. Second run carrying this note.
Fix shape: add a jq arm to the Step 1b extract for Stop/UserPromptSubmit hook payloads (find the JSONL field shape by probing one session known to have tripped turn-end-shape-gate), plus an unmeasurable-is-not-zero convention in the GUARD LEDGER instructions of the skill.
Acceptance: a positive-control grep on a session known to have tripped a Stop hook returns a non-zero count from the new extract; the skill text says which hooks the extract can and cannot see.
<!-- SECTION:DESCRIPTION:END -->
