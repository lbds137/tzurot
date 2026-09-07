---
id: TASK-908
title: >-
  Reply-to context for messages inside the chat history, not only the current
  turn
status: To Do
assignee: []
created_date: '2026-09-07 16:15'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 906000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the current turn marks what a message is replying to (bot-client ReplyReferenceStrategy under handlers/references/strategies, resolved through ReplyResolutionService, rendered by the ai-worker referenced-message path), but earlier messages in the assembled history carry no such marker, so when other users reply to specific messages the model sees a flat sequence and loses who was answering whom. Owner request 2026-09-07 with two Discord screenshots of a multi-user channel where the replies only make sense with their targets.
Grounding: conversation_history.message_metadata (prisma/schema.prisma, the ConversationHistory model, Json default {}) already holds a referencedMessages list that services/bot-client/src/services/channelFetcher/messageMetadataBuilder.ts merges link-resolved references into; services/ai-worker/src/services/storedReferenceHydrator.ts and services/ai-worker/src/services/prompt/RenderableReference.ts hydrate and render stored references. First step is to verify by grep and a dev probe whether reply-type references (message.reference) reach message_metadata for stored rows and whether the history render (services/ai-worker/src/services/context/RealMessagesBuilder.ts) shows them for non-current turns; the shipped answer for both is unverified at filing.
Fix shape: for every history message with a reply target, render a one-line marker before the message naming the target author and a truncated quote of the target text, in the same vocabulary the current-turn reply marker uses so the model learns one shape. Calibrate the quote cap to what the Discord client shows in its reply preview: the clip is layout-based, not a fixed count — two owner screenshots on mobile show a 120-character target fully visible and another target clipped after about 88 characters because the author header ate part of the preview line — so a cap near 100 characters approximates the mobile view; probe the desktop client before hard-coding the number, and mark the constant as calibrated-to-UI, not to a Discord API limit. Budget: the marker rides inside the existing history token budget (ContextWindowManager), so count it.
Acceptance: a stored reply inside the history renders with its target marker in the assembled prompt (component test through the real history builder), the cap constant is documented with the measurement, and a channel like the screenshots reads coherently in a debug payload.
<!-- SECTION:DESCRIPTION:END -->
