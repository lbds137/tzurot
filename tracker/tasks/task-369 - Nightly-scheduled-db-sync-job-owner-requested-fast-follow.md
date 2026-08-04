---
id: TASK-369
title: Nightly scheduled db-sync job (owner-requested fast follow)
status: To Do
assignee: []
created_date: '2026-07-31 00:50'
updated_date: '2026-08-04 13:56'
labels:
  - 'area:bot-client'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 369000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Owner-requested 2026-07-30**, alongside the beta.188 release: run db-sync on a nightly schedule the same way the conversation-history prune/cleanup runs, instead of only on demand via `/admin db-sync`.

**Existing pattern to follow**: `createIntervalScheduler` (`services/bot-client/src/utils/intervalScheduler.ts`) already backs three schedulers — `RetentionNagScheduler`, `VerificationCleanupScheduler`, `SecretRotationNagScheduler` — each with daily + startup firing and a Redis cooldown. The extraction that created it also fixed a stray-startup-timer-on-stop gap, so it is the vetted shape.

**Wiring**: the sync itself lives api-gateway side (`DatabaseSyncService`, reached via `ownerClient.dbSync({dryRun, allowSchemaSkew})` from `services/bot-client/src/commands/admin/db-sync.ts`). A scheduler in bot-client can call the same client method the slash command does, so no new gateway surface is needed.

**Decide while building**: dry-run vs real by default (a nightly REAL sync is a mutation on a schedule — probably wants dryRun with an owner-channel report, and an explicit opt-in for real), and whether a nightly failure nags the owner channel the way the retention scheduler does.

**Related**: recurrence should become owner-tunable rather than hard-coded — see the scheduled-jobs admin surface idea doc, which covers this job and the history cleanup together.
<!-- SECTION:DESCRIPTION:END -->
