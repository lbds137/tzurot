---
id: TASK-645
title: >-
  Floor-hop gate ignores the inherited quota category, same dead-end one hop
  down
status: To Do
assignee: []
created_date: '2026-08-17 21:21'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 645000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review of #2128 flagged that attemptFloorHop in quotaFallbackRunner.ts gates the bounded second hop purely on classifyQuotaFailure(retryError) === null. It does not consult opts.inheritedQuotaCategory, nor info.category which already carries the resolved category. If the hop-1 retarget retry itself fails with a non-classifiable error (another unclassifiable 4xx), the floor hop is skipped and the original error rethrows — the same dead-end shape #2128 fixed at the OUTER gate, one hop further down.

Pre-existing, not introduced or regressed by #2128; the reviewer explicitly did not ask for a fix in that PR. Risk is low because hop-1 targets are admin defaults, presumably always valid on OpenRouter, unlike the z.ai staggered-release scenario that triggers the primary bug.

Fix shape: decide whether attemptFloorHop should fall back to info.category (preferred — it is the already-resolved category for THIS retarget) or to opts.inheritedQuotaCategory, then pin it with a test that drives hop-1 failure with a non-classifiable error and asserts the floor hop is still attempted. Note the outer gate deliberately prefers LIVE classification, so keep the same precedence.

Acceptance: a hop-1 retry failing with an unclassifiable error still reaches the floor hop, pinned by a test; or the current behaviour is deliberately kept with the reason recorded in a comment at the gate.
<!-- SECTION:DESCRIPTION:END -->
