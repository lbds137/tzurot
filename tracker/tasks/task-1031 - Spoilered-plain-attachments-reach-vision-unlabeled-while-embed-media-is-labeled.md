---
id: TASK-1031
title: >-
  Spoilered plain attachments reach vision unlabeled while embed media is
  labeled
status: To Do
assignee: []
created_date: '2026-09-21 09:48'
updated_date: '2026-09-23 03:18'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1025000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a Components-V2 gallery item the poster marked as a spoiler renders with spoiler="true" on its <image> element (owner ruling: label, do not withhold), so the character knows the image was hidden. A plain Discord attachment uploaded as a spoiler (the SPOILER_ filename prefix, or the spoiler flag on the attachment) has no equivalent: it reaches vision and the prompt with no label, so the character can tell an embed image was hidden but not a directly attached one. Surfaced by the PR #2461 round-4 review; not introduced there.
Fix shape: read the spoiler signal on discord.js Attachment (the SPOILER_ prefix on the name is the documented convention; verify whether the flag also arrives on the object), carry it on AttachmentMetadata as an optional boolean (schema in packages/common-types/src/types/schemas/discord.ts, same shape as isEmbedPreview), and render it on the [Image: ...] header and the reference-path <image> element the way the embed path does. Cross-service: bot-client sets it, ai-worker renders it.
OWNER RULING 2026-09-22: label it, the same way as embed media (a human can click to unmask either kind, so the character is told either way).
Acceptance: a SPOILER_-prefixed upload renders a spoiler marker in the current-turn header and the reference render; a normal upload is unchanged; the embed path is unchanged.
<!-- SECTION:DESCRIPTION:END -->
