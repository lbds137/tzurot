---
id: TASK-956
title: >-
  Watch: prod Postgres lock-timeout window (2026-07-12) — probe DURING the next
  occurrence
status: To Do
assignee: []
created_date: '2026-09-13 15:53'
labels:
  - 'area:db'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 953000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: moved off backlog/now.md 🚨 (2026-09-13 context-budget trim). Recurring canceling statement due to lock timeout on gateway writes 15:24–16:32Z 2026-07-12; not db-sync, not retention; the post-hoc probe found no live contention so the holder is unidentified. Mitigation live since beta.161 (#1606): main-pool idle_in_transaction_session_timeout=60s reaps app-held wedged transactions; an EXTERNAL wedged session (DB console) is out of its reach and ALTER DATABASE is the escalation.
Promote when: the next occurrence — run the pg_stat_activity / pg_blocking_pids probe DURING the window (one-off script shape per the original session lock-probe.ts).
<!-- SECTION:DESCRIPTION:END -->
