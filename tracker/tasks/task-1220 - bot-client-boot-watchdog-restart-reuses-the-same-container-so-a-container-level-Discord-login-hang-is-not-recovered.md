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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Recurred 2026-10-23 (prod bot-client redeploys at 14:27Z and 14:41Z for the Discord token rotation): two fresh containers (hostnames 99c85adc897f, 7cafb1362625) both hung after 'Gateway is healthy'; the boot watchdog fired at 14:46:24 and the in-container restart hung again. Root-cause evidence, observed: `railway ssh` into the hung container, an unauthenticated `fetch('https://discord.com/api/v10/gateway')` returned HTTP 429 in 96 ms with `retry-after: 32260` and a Cloudflare HTML error page, while the same request from the Deck succeeded and the token was valid (users/@me 200, 1000/1000 session starts). So the container's egress IP is Cloudflare-banned by Discord and discord.js waits out the retry-after silently. Inference, not verified: the ban comes from other tenants on Railway's shared egress IPs, not from our own traffic. A fix candidate beyond the watchdog: Railway static outbound IPs (cost), or detect a REST 429 with a long retry-after at boot and fail loudly / alert.
<!-- SECTION:NOTES:END -->
