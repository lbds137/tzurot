---
id: TASK-157
title: AttachmentMetadata.isVoiceMessage is z.boolean().optional()
status: To Do
assignee: []
created_date: '2026-06-23 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:common-types'
  - 'size:S'
dependencies: []
priority: low
ordinal: 157000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`AttachmentMetadata.isVoiceMessage` is `z.boolean().optional()` — latent silent false-negative

**Why:** PR #1309 made `forwardedMessageUtils.hasForwardedVoiceAttachment` read `a.isVoiceMessage === true` instead of re-deriving from content-type+duration. Correct **as long as** every `AttachmentMetadata` was built by `extractAttachments` (the only constructor today, always reached via `extractAllForwardedContent`). But the Zod schema (`packages/common-types/src/types/schemas/discord.ts:~58`) marks the field `optional()`, so a future construction path that omits it yields `isVoiceMessage: undefined` → `hasForwardedVoiceAttachment` silently returns `false` for a real voice message. The forwardedMessageUtils docstring documents the trust chain; the schema doesn't. **Fix shape**: make `isVoiceMessage` required in the schema (audit all `AttachmentMetadata` constructors first — it's a cross-service shape), or add a constructor-guard. **Promote when**: a second `AttachmentMetadata` construction path is added, OR the field's required-ness is being reconsidered. Surfaced 2026-06-23 by PR #1309 final claude-review (Finding 3, non-blocking).
<!-- SECTION:DESCRIPTION:END -->
