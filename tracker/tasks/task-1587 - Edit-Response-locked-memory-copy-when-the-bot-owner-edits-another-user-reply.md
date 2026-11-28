---
id: TASK-1587
title: 'Edit Response: locked-memory copy when the bot owner edits another user reply'
status: To Do
assignee: []
created_date: '2026-11-28T08:53:00Z'
labels:
  - area:bot-client
  - size:S
  - state:owner
dependencies: []
priority: low
ordinal: 1577000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: from #2833 review r6. When the bot owner edits a reply whose turn belongs to another user and that user memory is locked, the refusal says "This reply's memory is locked. Unlock it in /memory to edit." The bot owner cannot unlock it from their own /memory (memoryPreflight.ts LOCKED message; memoryBlocker compares against the turn persona).
What: a neutral message on the bot-owner path, e.g. "This reply's memory is locked by its owner, so it cannot be edited."
Acceptance: the bot-owner path shows the chosen copy; unit test in memoryPreflight.test.ts.
Owner question: Should the bot owner see a different locked-memory message when editing another user reply?
Recommendation: yes, neutral copy naming the owner — the current text points at an action they cannot take.
<!-- SECTION:DESCRIPTION:END -->
