---
id: TASK-960
title: >-
  Verify whether a second personality in the same channel sees the first one
  reply this turn
status: To Do
assignee: []
created_date: '2026-09-13 17:24'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 957000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: shapes.inc shipped 2026-09-05 "each Shape sees replies already sent by other Shapes during that turn" as a fix, which means their multi-character turns were previously blind to each other. Whether Tzurot has the same blind spot is unknown — a one-grep look at services/ai-worker/src/services/context/ and jobs/utils/conversationUtils.ts on 2026-09-13 found no cross-personality same-turn handling either way. Adjacent to TASK-14 (langchainConverter attributes every stored assistant row to the current personality), which is about how OTHER personalities rows render, not whether the current turn reply of a sibling is present.
Fix shape: read-only check first — trace what conversation history a personality B loads when personality A already replied in the same channel seconds earlier (does the A reply row exist in conversation_history before B assembles, and does B history query include rows whose personalityId differs). Record the answer in this task. If B cannot see A, decide with the owner whether it should (chime-in and multi-character channels are the surfaces); only then file the build.
Acceptance: the task body states, with the file:line of the history query, whether a sibling personality same-turn reply is in context; a build task exists only if the owner wants the behaviour.
<!-- SECTION:DESCRIPTION:END -->
