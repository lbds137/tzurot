---
id: TASK-1054
title: >-
  NightlyDbSync and ExportSmoke schedulers raise a false failure embed when
  their startup run lands in a gateway deploy window
status: To Do
assignee: []
created_date: '2026-09-23 13:17'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1048000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1043 (PR #2487) added isGatewayNotReadyFailure (services/bot-client/src/utils/gatewayNotReady.ts) and a startup-run retry to ArchivePromotionScheduler. The orchestrator sweep found two siblings with the same deploy-window false alarm in narrower form. NightlyDbSyncScheduler: inside its configured UTC hour, a not-ready gateway on dbSync posts the failure embed (NightlyDbSyncScheduler.ts ~196-204) AND the already-armed cooldown loses that day of sync. ExportSmokeScheduler: when its weekly cooldown has lapsed, a failing startExportSmoke posts the could-not-start embed (ExportSmokeScheduler.ts ~203-210) and arms the weekly cooldown, losing that week of smoke. SecretRotationNag, ReleaseFlagNag and VerificationCleanup were checked and do not alert.
Fix shape: on the startup run, classify with isGatewayNotReadyFailure and retry once after ~5 min before alerting and before arming the cooldown. Verify first that neither route answers 404 on its own (the helper JSDoc caller contract).
Acceptance: per scheduler, a startup not-ready failure with a successful retry posts nothing and completes the sync/smoke; a failing retry posts once.
Design note (claude-review on PR #2487): 1043 kept the startup flag and retry timer local to ArchivePromotionScheduler because createIntervalScheduler.run swallows errors, so the factory cannot see failures. With two more adopters, the flag + timer + stop-clear plumbing would be three copies: consider extracting it (a small startup-retry helper in bot-client, or a run-result protocol on the factory) as part of this task, subject to the 2-callback ceiling in 02-code-standards.md.
<!-- SECTION:DESCRIPTION:END -->
