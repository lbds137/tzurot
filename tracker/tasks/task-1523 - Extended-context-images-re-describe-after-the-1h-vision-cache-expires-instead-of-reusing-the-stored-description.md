---
id: TASK-1523
title: >-
  Extended-context images re-describe after the 1h vision cache expires instead
  of reusing the stored description
status: To Do
assignee: []
created_date: '2026-11-24T01:45:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1521000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-11-24 01:36Z one Emily turn in a Hazbin Hotel thread sent 20 extended-context images to vision inline; 14 exhausted every tier during a z.ai overload, although other characters had described those images earlier in the channel. The canonical cache (vision:canon, model-agnostic) IS checked before any call (visionDescribeGates.ts readValidCachedDescription, ahead of the invoke), but it is Redis-only with VISION_DESCRIPTION_TTL 60*60 (common-types constants/timing.ts). A channel image older than 1h is a guaranteed miss, so every turn re-pays vision for the whole extended-context window, and a busy channel turns one message into a 20-call burst (the amplifier behind TASK-1522).

What: give extended-context images a durable source before vision. Candidates to evaluate: (a) read persisted attachmentEnrichment from conversation-history rows keyed by attachment id (today only the reference formatters, storedReferenceHydrator and ownVoiceGuard read it; DependencyStep and DownloadAttachmentsStep do not); (b) a longer canonical TTL for attachment-id keys (Discord attachment ids are immutable); (c) a durable description store (durability-tiers.md tier 3 question, same shape as TASK-389). Verify first whether the images in question have enrichment rows at all: extended-context images come from the Discord channel fetch, not from history rows.

Acceptance: an extended-context image described once in a channel is not re-sent to a vision model on later turns within a stated retention window, pinned by a test; the window and its storage tier are written into durability-tiers.md.

Observed vs inferred: cache-before-invoke is read from code; 14 exhausted chains are in prod logs; that the misses were TTL expiry is inferred (cache hits log at debug, invisible in prod).
<!-- SECTION:DESCRIPTION:END -->
