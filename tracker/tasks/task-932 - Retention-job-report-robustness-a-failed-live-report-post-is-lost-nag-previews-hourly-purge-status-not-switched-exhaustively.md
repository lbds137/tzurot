---
id: TASK-932
title: >-
  Retention job report robustness: a failed live-report post is lost, nag
  previews hourly, purge status not switched exhaustively
status: Done
assignee: []
created_date: '2026-09-10 20:59'
updated_date: '2026-09-11 18:50'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 930000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the #2386 round-5 review found three low items in the new retention job (services/bot-client/src/services/retentionRun/). (1) RetentionRunScheduler reportLiveRun posts the live-run report once; the 23h cooldown is armed before the run, so a failed postOwnerChannelEmbed on the day an account is erased loses that report (the audit ledger keeps the record, the owner channel never sees it). (2) retentionNag runRetentionNagCheck fetches the preview on every hourly tick and reads its cooldown only after, unlike retentionRehearsal which reads the cooldown first. (3) retentionLiveRun applyPurgeResult treats any non-purged status as a skip; a future third status would silently land in the skip bucket.
Fix shape: (1) a pending-report Redis key retried on the next tick until delivered, or at minimum a warn-level log carrying the full summary when delivery fails; (2) read the nag cooldown first; (3) an exhaustive switch on result.data.status with a never-typed default.
Acceptance: tests pin a failed post being retried (or warned with the summary), the nag skipping the preview while cooling, and an unknown status surfacing rather than counting as a skip.
Priority medium: item 1 is a data-rights visibility gap for an erasure.
<!-- SECTION:DESCRIPTION:END -->
