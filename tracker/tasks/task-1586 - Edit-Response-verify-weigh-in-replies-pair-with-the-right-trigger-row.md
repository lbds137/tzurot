---
id: TASK-1586
title: 'Edit Response: verify weigh-in replies pair with the right trigger row'
status: To Do
assignee: []
created_date: '2026-11-28T05:37:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1576000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review on PR 2833 (finding 9). findImmediateTriggerRow with personaId finds the preceding row of that persona inside the 60s pairing window. A trigger-less assistant row (weigh-in, activated chatter) may carry the persona of whoever triggered it, so editing a weigh-in could pair with that persona's own earlier user turn and rewrite the wrong exchange memory. The memory lookup (messageIds hasSome + personality) mostly saves it; unverified.
What: trace which personaId weigh-in and activated-chatter assistant rows are persisted with (bot-client ConversationPersistence and its callers), then add a PGLite component case in historyEdit.component.test.ts: a weigh-in preceded within the window by the same persona's turn for a different exchange.
Acceptance: the component test pins that the edit rewrites no memory or only the weigh-in's own; fix the pairing if it does not.
<!-- SECTION:DESCRIPTION:END -->
