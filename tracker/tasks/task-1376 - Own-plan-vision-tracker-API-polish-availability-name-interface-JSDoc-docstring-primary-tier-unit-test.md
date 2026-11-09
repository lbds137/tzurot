---
id: TASK-1376
title: >-
  Own-plan vision tracker API polish: availability name, interface JSDoc,
  docstring, primary-tier unit test
status: To Do
assignee: []
created_date: '2026-11-09T22:32:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1359000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review's fourth pass on PR 2732 (merged at its review-round cap) left four readability and coverage items in services/ai-worker/src/services/multimodal/visionAuthResolver.ts.
(1) VisionQuotaTracker.hasOwnZaiClaim() returns true while the claim is still AVAILABLE, the inverse of the claimedOwnZaiVision state it reads. Rename it to an availability name (e.g. canClaimOwnZaiVision), and give it and tryClaimOwnZaiVision a one-line interface JSDoc each, saying which consumes and which does not.
(2) The VisionQuotaTracker docstring repeats its opening phrase; say there that the Quota name is historical (the rename itself stays declined).
(3) resolveVisionConfig discards tryClaimOwnZaiVision()'s result on purpose (the pre-spend): mark it with `void` or a comment.
(4) No unit test reaches the own-plan arm with isPrimaryTier true (a z.ai-only user whose vision model is OpenRouter-routed, the common real shape); scenario 6 covers it end to end. Add a variant of test A with true.
Acceptance: the four items done; the multimodal suite green.
<!-- SECTION:DESCRIPTION:END -->
