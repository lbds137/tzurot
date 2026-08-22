---
id: TASK-733
title: >-
  crossChannelMessageSchema cannot express a quote-bearing row - dedup pins need
  casts
status: To Do
assignee: []
created_date: '2026-08-22 17:07'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 733000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced during TASK-726 (the cross-channel flag-on dedup-wording pin): crossChannelMessageSchema declares neither discordMessageId nor messageMetadata, so the type system cannot represent a cross-channel row that carries a deduplicatable quote — only the runtime renderer can, and the regression test uses a documented cast to construct one. A schema that cannot express a state the renderer handles is a latent drift seam (the Zod strip class from 02-code-standards: a response key not declared in the wire schema is deleted before the caller sees it — if cross-channel rows ever DO carry quote metadata over this schema, it would be silently stripped).
What: decide whether cross-channel rows should declare the quote-bearing fields (extending crossChannelMessageSchema to a Pick of the main history row shape) or whether the renderer path is fed from a non-Zod-gated source making the cast permanently honest — then either extend the schema + drop the cast, or document the boundary at the schema with the reason. Verify against the actual producer (where cross-channel groups are assembled) before choosing.
Acceptance: the cast in the dedup-wording pin either disappears (schema extended) or is backed by a schema-level comment naming why the state is unrepresentable; producer verified either way.
<!-- SECTION:DESCRIPTION:END -->
