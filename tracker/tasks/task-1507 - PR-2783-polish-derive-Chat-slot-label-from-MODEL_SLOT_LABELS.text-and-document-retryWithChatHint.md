---
id: TASK-1507
title: >-
  PR 2783 polish: derive Chat slot label from MODEL_SLOT_LABELS.text and
  document retryWithChatHint
status: To Do
assignee: []
created_date: '2026-11-22T05:14:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1507000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2783 claude-review r1 low/nit findings on services/api-gateway/src/utils/llmConfigValidation.ts. BOTH_SLOT_CHAT_HINT currently hardcodes the literal Chat instead of interpolating MODEL_SLOT_LABELS.text (packages/common-types/src/constants/ai.ts:392), and ensureVisionCapableModel JSDoc does not yet mention options.retryWithChatHint. What: interpolate MODEL_SLOT_LABELS.text in BOTH_SLOT_CHAT_HINT, assert through the constant in llmConfigValidation.test.ts and route tests, and add one JSDoc line explaining when callers pass retryWithChatHint. Acceptance: hint and tests reference MODEL_SLOT_LABELS.text and api-gateway tests + lint pass.
<!-- SECTION:DESCRIPTION:END -->
