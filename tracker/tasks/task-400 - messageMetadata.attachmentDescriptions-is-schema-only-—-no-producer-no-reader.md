---
id: TASK-400
title: 'messageMetadata.attachmentDescriptions is schema-only — no producer, no reader'
status: Done
assignee: []
created_date: '2026-08-02 14:34'
updated_date: '2026-08-06 08:58'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 400000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the JSONB field is declared in messageMetadataSchema (packages/common-types/src/types/schemas/message.ts) with a comment implying it is stored, but a probe of the full retained history found 0 of 4,020 user turns carrying it, and a repo grep found no assignment site and no reader. Attachment descriptions actually live appended in the content column (VisionDescriptionWriter). The dead field actively misleads: TASK-393 was originally scoped assuming it was populated, and the goldens miner had to discover the content-marker reality by DB probe.

Fix shape: either (a) delete the field from the schema (cleanest — no consumer exists), or (b) have VisionDescriptionWriter write structured entries alongside the content upgrade IF a consumer emerges (the allocation A/B may become one). Decide when next touching the schema; default to (a).

Acceptance: no schema field that nothing writes; any doc comment on message_metadata matches what producers actually store.
<!-- SECTION:DESCRIPTION:END -->
