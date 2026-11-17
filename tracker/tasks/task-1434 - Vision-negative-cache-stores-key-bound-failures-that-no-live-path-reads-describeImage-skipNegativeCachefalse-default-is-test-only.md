---
id: TASK-1434
title: >-
  Vision negative cache stores key-bound failures that no live path reads;
  describeImage skipNegativeCache=false default is test-only
status: To Do
assignee: []
created_date: '2026-11-17T03:29:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1434000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: split from TASK-1374 (closed obsolete 2026-11-16). VisionProcessor.ts stores every failure category in the per-model negative cache (grep storeFailure), but the only reader, checkNegativeCache in visionDescribeGates.ts, runs with longTtlOnly on every live path because every production caller passes skipNegativeCache true (ImageDescriptionJob.ts, AttachmentProcessor.ts, MultimodalProcessor.ts, describeImageWithFallback.ts runVisionTier). So short-TTL entries (rate_limit, quota, auth, timeout) are written and never read. Prod evidence 10-23..11-16 (8 ai-worker deployments): 568 rate_limit stores, 0 skips on any short-TTL category; all 218 skips were media_not_found.

What: either store only LONG_TTL_FAILURE_CATEGORIES (drop the dead writes) or make the full-honor read mode reachable on purpose; and remove or justify the skipNegativeCache=false default of describeImage, which only tests exercise. Update the tests that encode the unreachable mode.

Acceptance: no write without a reader; describeImage has no mode only tests reach (or a comment names its intended caller); ai-worker suite green.
<!-- SECTION:DESCRIPTION:END -->
