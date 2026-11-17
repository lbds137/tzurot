---
id: TASK-1433
title: >-
  User with a revoked or invalid stored z.ai key pays one failed own-plan flash
  vision call per image
status: To Do
assignee: []
created_date: '2026-11-17T03:29:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1433000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: split from TASK-1374 (closed obsolete 2026-11-16). When a user has a stored z.ai key that is revoked or invalid, every image in a turn first tries the own-plan glm-5.3-flash tier, gets an auth error, and only then advances. The per-walk claim and lookup memo reset per image (services/ai-worker/src/services/multimodal/describeImageWithFallback.ts, grep tryClaimOwnZaiVision), and the negative cache does not help: every live describeImage caller passes skipNegativeCache, so a cached AUTHENTICATION entry is never honored (visionDescribeGates.ts checkNegativeCache longTtlOnly). Cost: added latency (one failed call) per image for that user. Fail-soft, no wrong output.

What: a per-user negative signal for a user-key auth failure on the own-plan tier, so the walk skips flash for that user for a short window (or until the key is re-set). Decide keying (user id + provider), TTL, and invalidation on /settings apikey set.

Acceptance: a user-key flash auth failure makes later images in the window skip the flash tier for that user only; another user and a system-key walk are unaffected; re-setting the key clears the signal; a seam test proves the skip.
<!-- SECTION:DESCRIPTION:END -->
