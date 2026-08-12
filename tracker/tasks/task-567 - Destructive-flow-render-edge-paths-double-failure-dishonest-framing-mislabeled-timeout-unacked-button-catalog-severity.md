---
id: TASK-567
title: >-
  Destructive-flow render edge paths: double-failure dishonest framing,
  mislabeled timeout, unacked button, catalog severity
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 567000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: four residual edge paths in the #2050/#2053 area. (1) When the applied-phase fallback render ITSELF throws, the rejection reaches CommandHandler catch-all which renders failure/retry framing over an already-applied destructive write - the exact class both PRs fixed, surviving in the two-consecutive-Discord-failures path (confirmDestructive.ts:368-372, CommandHandler.ts:281-289). Fix: swallow-and-log on the applied-phase fallback. (2) batchDelete.ts:210-226 renders "timed out" for ALL awaitMessageComponent rejections (message deleted, channel gone) and the comment overclaims "only an actual timeout". (3) A failed cancel/confirm ack leaves the button interaction unacked -> Discord native "This interaction failed" banner beside the corrected message; best-effort re-ack would close it. (4) destructiveApplied lives under CATALOG.error.* with severity success - namespace/severity mismatch.

Source: 2026-08-12 review, bot-client F5/F6/F7/F8, all CONFIRMED mechanism.
<!-- SECTION:DESCRIPTION:END -->
