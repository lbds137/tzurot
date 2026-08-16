---
id: TASK-634
title: Dev retention nag recommends a purge whose deletions would sync to prod
status: To Do
assignee: []
created_date: '2026-08-16 22:56'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 634000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner observed Rotzot (dev bot) posting the retention-purge nag (2026-08-16). The scheduler is env-agnostic, dev DB mirrors prod users via sync, and three facts compose into a footgun: (1) retention purge writes sync_tombstones so deletions cannot be resurrected - correct for prod; (2) the same tombstones make a DEV-side purge propagate user deletions TO PROD on the next sync (LWW on deleted_at); (3) the dev nag footer recommends `pnpm ops retention:purge --env dev`, and the CLI confirmation prompt guards env=prod only (packages/tooling/src/retention/purge.ts:113) so the dev invocation runs unprompted. No incident occurred; the nag is advisory and nothing purges automatically.
Fix shape (both halves): (a) gate RetentionNagScheduler to NODE_ENV=production - the dev report is a prod-mirror echo with zero dev-specific signal; (b) extend the purge confirmation (or hard-refuse) to env=dev, because users is sync-tracked and a dev purge is exactly as consequential as prod. Consider the same review for any other destructive ops CLI whose prod-only prompt assumes dev is low-stakes on sync-tracked tables.
Acceptance: dev deployments post no retention nag; `retention:purge --env dev` cannot run without the same explicit confirmation as prod (test pins both).
<!-- SECTION:DESCRIPTION:END -->
