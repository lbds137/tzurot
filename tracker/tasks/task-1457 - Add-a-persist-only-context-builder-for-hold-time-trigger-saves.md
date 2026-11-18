---
id: TASK-1457
title: Add a persist-only context builder for hold-time trigger saves
status: To Do
assignee: []
created_date: '2026-11-18T22:19:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1457000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The doc-66 hold path (PersonalityChatManager.saveUserMessage, PR 2769) runs a FULL buildContext per held activation trigger — Discord history fetch and reference/attachment assembly included — but uses only personaId, messageContent, triggerMessage, triggerEmbedsXml and context.attachments for the persisted row. In a busy activated channel coalescing removes generation cost but adds N full context builds. Review finding #9 (round 1). Fix: a lighter persist-only builder path in MessageContextBuilder that skips history assembly and extended context; saveUserMessage uses it. Acceptance: saveUserMessage no longer fetches conversation history (verify with a mock-count test) and the persisted row shape is unchanged.
<!-- SECTION:DESCRIPTION:END -->
