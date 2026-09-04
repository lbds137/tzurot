---
id: TASK-343
title: Lower AI_GENERATE_SUBMIT now that submit is enqueue-only
status: To Do
assignee: []
created_date: '2026-07-28 19:30'
updated_date: '2026-09-04 19:36'
labels:
  - 'size:S'
  - 'area:bot-client'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 343000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 60s bot-client timeout for AI generate submission was sized for the era when api-gateway downloaded extended-context attachments synchronously in the handler (observed >10s on 12-attachment payloads). That work moved to ai-worker DownloadAttachmentsStep, so the submit path is enqueue-only and the 60s cap is pure historical headroom.
Fix shape: measure real submit latency in prod logs (creationTimeMs is already logged by the generate handler), then drop AI_GENERATE_SUBMIT toward GATEWAY_RPC/GATEWAY_BULK_FETCH scale. Semantic change (timeout default) — measure first, never blind-lower.
Acceptance: constant lowered with a comment citing the measured p99; generate path verified in dev.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Constant still carries the old 60s headroom; the comment itself says lowering it is tracked in the backlog. Real (if minor) cost: an unnecessarily generous client timeout masking real hangs longer than needed. Evidence: `sed -n '75,90p' packages/common-types/src/constants/timing.ts` → `AI_GENERATE_SUBMIT: 60_000` with a comment confirming submit is now enqueue-only and the lowering is still pending.
---
<!-- COMMENTS:END -->
