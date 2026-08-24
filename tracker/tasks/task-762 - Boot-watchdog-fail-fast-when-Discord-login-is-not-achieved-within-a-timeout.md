---
id: TASK-762
title: 'Boot watchdog: fail fast when Discord login is not achieved within a timeout'
status: To Do
assignee: []
created_date: '2026-08-24 14:33'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 762000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-08-24 dev outage - the post-merge boot hung inside the boot-time Discord REST global-command PUT (last log line "Redis client ready", no login for 85 minutes) while Railway showed SUCCESS, so nothing restarted it and nothing alerted; the error-channel reporter is structurally blind to boot hangs because the bot never logs in. Same code booted cleanly on manual redeploy, so the hang was a transient REST stall with no timeout.

Fix shape: a startup deadline in bot-client index.ts - if the Discord client has not reached ready within N minutes (5 is generous; healthy boots reach it in seconds), log the phase reached and process.exit(1) so the platform restart policy recovers automatically. Optionally add an AbortSignal.timeout to the deploy-commands REST call, which was the observed stall point.

Acceptance: a simulated never-resolving login (test with fake timers) exits nonzero after the deadline with a log line naming the last completed boot phase; normal boots are unaffected.
<!-- SECTION:DESCRIPTION:END -->
