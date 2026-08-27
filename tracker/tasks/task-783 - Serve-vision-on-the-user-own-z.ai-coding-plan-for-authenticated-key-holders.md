---
id: TASK-783
title: Serve vision on the user own z.ai coding plan for authenticated key-holders
status: To Do
assignee: []
created_date: '2026-08-27 14:09'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 783000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: an authenticated user holding a zai-coding BYOK key but no OpenRouter key hits the broad free fallback for vision (visionAuthResolver.ts:352-375: tryResolveUserKey(userId, visionProvider) misses, resolveBroadFreeFallback downgrades to the free OpenRouter pool) — the same chronically-unreliable pool TASK-735 measured at 35-52% weekly failure. glm-5.3-flash is vision-capable on the coding plan (ZAI_MODEL_CATALOG supportsVision, live-probed 2026-08-25), so their OWN plan could serve vision instead.

Fix shape: in the authenticated arm of resolveVisionAuth, before the broad free fallback, try flash on the user own zai-coding key (their spend, no admission gate needed). Sibling of the guest vision piggyback unit that filed this task — reuse its tier/auth mechanics.

Acceptance: a zai-key-holder without an OpenRouter key gets flash-described images on their own key; users with an OpenRouter vision key keep current behavior; seam test asserts the key/provider crossing.
<!-- SECTION:DESCRIPTION:END -->
