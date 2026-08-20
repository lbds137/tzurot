---
id: TASK-692
title: Inspect view for stored vision descriptions
status: To Do
assignee: []
created_date: '2026-08-20 01:52'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 692000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: when a persona misreads an image, the vision description is the diagnostic, but today it is only reachable by digging through the system-prompt view in /inspect - ergonomics pain the owner confirmed (2026-08-19). Storage is split (verified 2026-08-19): the vision cache is Redis-ONLY with a 1h TTL (services/ai-worker/src/services/VisionDescriptionCache.ts - its docblock records the Postgres L2 being removed in beta.110), while durable descriptions exist for REFERENCED-message attachments via message_metadata.attachmentEnrichment (packages/common-types/src/types/schemas/message.ts:161). No view in services/bot-client/src/commands/inspect/ surfaces descriptions directly (grep verified 2026-08-19).

Fix shape: an /inspect surface that shows the description(s) for a chosen message from wherever the existing inspect data already carries them (the stored generation/prompt record and/or message_metadata enrichment) - read-only over already-stored data, zero new vision spend, no upload needed. Scoping which stores to read from is part of the task; availability will vary (Redis TTL for own-message descriptions).

Scope note: this is debugging ergonomics, NOT a standalone /describe capability command - the owner ruled that out (doc-11 accepted design routes capabilities as character tools, generate_image is tool-only, describe_image becomes a model-invoked tool post-agentic-Phase-1).

Acceptance: from a message that had an image described, the owner can reach the description via /inspect without reading the whole system prompt.
<!-- SECTION:DESCRIPTION:END -->
