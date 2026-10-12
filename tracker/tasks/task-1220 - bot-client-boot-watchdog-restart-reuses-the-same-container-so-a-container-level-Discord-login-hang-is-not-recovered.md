---
id: TASK-1220
title: >-
  bot-client boot watchdog restart reuses the same container, so a
  container-level Discord login hang is not recovered
status: To Do
assignee: []
created_date: '2026-10-12 04:52'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1209000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after the beta.236 deploy (2026-10-12 04:43Z) prod bot-client hung in client.login() after the 'Gateway is healthy' log, twice. The boot watchdog fired correctly at 04:48:37 (lastPhase=gateway-health-checked, deadlineMs=300000) and exited, but Railway restarted the process in the SAME container (hostname b8b3cd4c9b22 before and after), and the restart hung at the same step. The bot stayed offline until a manual 'railway redeploy -s bot-client' at 04:50 got a fresh container (b3b9db20d6ed), which logged in within 0.5s. Same code logged in fine on dev at 04:35; the prod token was valid and Discord reported 1000 of 1000 session starts remaining throughout, so the hang was before identify (inference: an outbound connection from that container to Discord hung; not verified). The watchdog's premise that the platform restart policy recovers (services/bot-client/src/utils/bootWatchdog.ts) holds only for process-level faults.

What: (1) log discord.js debug events during boot until ready, so the stuck sub-step (REST /gateway/bot vs WebSocket connect vs identify) is visible next time; (2) find a recovery that replaces the container, or at least alert the owner channel or another surface when the boot deadline fires twice in one container; check what Railway offers (healthcheck path, restart policy) before building.

Acceptance: a forced login hang in a test shows the debug phase in logs; the chosen recovery or alert is exercised on dev end to end.
<!-- SECTION:DESCRIPTION:END -->
