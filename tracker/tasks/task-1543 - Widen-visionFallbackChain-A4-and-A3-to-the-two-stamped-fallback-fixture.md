---
id: TASK-1543
title: Widen visionFallbackChain A4 and A3 to the two-stamped fallback fixture
status: To Do
assignee: []
created_date: '2026-11-25T15:24:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1541000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2809 review round 6, finding 1. A3 and A4 in services/ai-worker/src/services/multimodal/visionFallbackChain.test.ts stamp one fallback, a shape where the floor was already inside the cap before 2809, so both pass on the pre-PR code too. The keyless spend guarantee (openrouter/auto never on the system key) is untested on the two-stamped shape the PR newly exposes. A local probe on 11-25 (A4 rerun with visionFallbackModels = glm-5.3-flash + gemma free) passed, so this is a coverage gap, not a bug.

What: parameterize A4 (and A3) over the one- and two-stamped fixtures.

Acceptance: the two-stamped A4 case exists, and a canary that removes the keyless filter for the floor turns it red.
<!-- SECTION:DESCRIPTION:END -->
