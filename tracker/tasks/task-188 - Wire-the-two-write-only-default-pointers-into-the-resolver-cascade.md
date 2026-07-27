---
id: TASK-188
title: 'Wire the two write-only default pointers into the resolver cascade'
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
labels: []
dependencies: []
ordinal: 188000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Wire the two write-only default pointers into the resolver cascade

**Why:** After P3-S3 the resolver reads only `freeDefaultLlmConfig` (`LlmConfigResolver`) and `globalDefaultVisionConfig` (`VisionConfigResolver`). The other two pointers — `globalDefaultLlmConfigId` (paid chat-global) and `freeDefaultVisionConfigId` (free vision) — are admin-settable and the delete guard honours them, but **no resolver tier consults them**, so setting either has no resolution effect today. This matches the pre-cutover flags (the LLM cascade never had a paid-chat-global tier; the vision-free read was already deferred — see `VisionConfigResolver` comment). **Side effect to fix when wiring**: an admin who sets one of these gets `{success:true}` with no live change AND is then blocked from deleting that config by the pointer-aware delete guard — invisible friction until the reader tiers ship; consider surfacing the occupied slot in the delete-guard 400 body at that point. **Fix shape**: add a `globalDefaultLlmConfig` read tier in `LlmConfigResolver` + a `freeDefaultVisionConfig` read tier in `VisionConfigResolver`. **Promote when**: Slice 4, or whenever the cascade gains a paid-chat-global / free-vision tier. Surfaced 2026-06-29 by PR #1388 (P3-S3) claude-review (referenced by the `setAsDefault` JSDoc).
<!-- SECTION:DESCRIPTION:END -->
