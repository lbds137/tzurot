---
id: TASK-1015
title: >-
  db-sync report: run-on bullets — the newline-aware chunker was never applied
  to sendChunkedReply
status: Done
assignee: []
created_date: '2026-09-18 16:15'
updated_date: '2026-09-18 22:37'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1011000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-18 13:55Z (db-sync formatting has broken sometime recently). The health webhook fix (commit 8c481e088, splitMessageByLines) replaced the single-newline-collapsing splitMessage for the health report only; the db-sync report still goes through sendChunkedReply, which uses splitMessage, so once a report exceeds one Discord message its bullets run together. Same defect class as TASK-561, second call site; the fix was offered in-session and not yet applied.
Fix shape: route sendChunkedReply (five callers per the session read; verify with grep -rn sendChunkedReply services/bot-client/src) through splitMessageByLines, or give db-sync its own line-aware path; regression test with a multi-bullet report longer than one message asserting each bullet keeps its own line.
Acceptance: a db-sync report longer than 2000 chars renders one bullet per line in every chunk; the health webhook path is unchanged.
<!-- SECTION:DESCRIPTION:END -->
