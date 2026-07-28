---
id: TASK-35
title: Wire the vision fallback loop into RAG-family paths
status: To Do
assignee: []
created_date: '2026-07-01 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:conversation-history'
  - 'area:ai-worker'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Wire the vision fallback loop into the RAG-family paths (referenced-message, history re-enrichment, current-message inline fallback)

**Why:** Phase 4 C2b shipped `describeImageWithFallback` for the two paths that hold the auth-INPUTS bundle (`ResolveVisionConfigOptions`) at the vision call site: the direct-attachment `ImageDescriptionJob` (primary) + the extended-context `processCrossProviderVisionImages`. The RAG-family paths still use single-model `describeImage`/`processAttachments` (NO fallback): (1) `ConversationInputProcessor` current-message inline fallback (`processAttachments` at :99), (2) `enrichRagHistory` conversation-history re-enrichment (`ragVisionAuth.ts:119`), (3) referenced-message images (`AttachmentProcessor.ts:255`). Source 4 (referenced-message) is a **primary** source per the routing map, so this isn't purely secondary. All three share `resolveRagVisionAuth`'s resolve-once-reuse-many structure — they thread the pre-resolved `ResolvedVisionAuth` OUTPUT, not the INPUTS the wrapper needs. **Fix shape**: have `resolveRagVisionAuth` also expose the auth-INPUTS bundle (or `ResolvedVisionAuth` carry it), thread `visionAuth` to the three sites, and switch `AttachmentProcessor` to call `describeImageWithFallback`. **Why not now**: the resolve-once-reuse restructure across ~4 files is its own cohesive slice; the two INPUTS-holding paths deliver the headline direct-attachment fallback with no regression (legacy single-model path preserved). **Promote when**: opportunistically after C2b, or when a referenced-message/history-image vision failure should auto-fall-back. Surfaced 2026-07-01 (Phase 4 C2b routing map).
<!-- SECTION:DESCRIPTION:END -->
