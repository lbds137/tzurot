---
id: TASK-1397
title: Two provenance labels sit outside the OUTPUT_CONSTRAINTS vocabulary
status: To Do
assignee: []
created_date: '2026-11-10T14:30:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1380000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: messageMetadataBuilder.ts:48-53 (bot-client channelFetcher) writes [${contentType}: name] with the raw name (no headerDisplayName) and a label not in HEADER_LABELS; referenceEnrichment.ts:180 (common-types) writes [Voice transcript]:. The model-facing rule (HardcodedConstraints.ts:124-125) names neither. Low severity: the first is XML-escaped downstream (QuoteFormatter.ts ~432) and the second is reached only by flagged voice messages.
What: route both through the shared label table, or name them in the constraint. Found by the Fable attachment-provenance review 2026-11-10 (D3, D4).
<!-- SECTION:DESCRIPTION:END -->
