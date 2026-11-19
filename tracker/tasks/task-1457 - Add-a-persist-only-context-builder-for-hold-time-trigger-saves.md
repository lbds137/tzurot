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

Folds (PR 2769 review rounds): (a) SEMANTICS — the hold-time build resolves no extendedContext, so extractRefsAndMentions maxReferences falls back to MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES; a user whose configured maxMessages differs gets a different reference window on the held row than the normal path would produce (row construction fields are pinned identical by test; the window difference is documented in the PR body). The persist-only builder should resolve or explicitly parameterize the reference window. (b) COST — confirm whether the no-extendedContext buildContext actually skips the Discord history fetch today, and make the persist-only path skip it by construction (round-7 #6/#7: one context build per held message partly offsets the coalescing savings).
<!-- SECTION:DESCRIPTION:END -->
