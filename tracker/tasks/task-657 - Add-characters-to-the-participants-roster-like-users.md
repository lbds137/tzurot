---
id: TASK-657
title: 'Add characters to the participants roster, like users'
status: To Do
assignee: []
created_date: '2026-08-18 13:17'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 657000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-08-18, during PR #2141 review. Characters are non-human users -- their details belong in the <participants> roster the same way persona details do.

The concrete gap: from_id is emitted ONLY for role="user" messages, bound to personaId (conversationUtils.ts:135-139). Character and assistant messages carry no from_id at all, because there is nothing in the roster for them to bind to. ParticipantFormatter.ts:225 instructs the model "Match from_id attribute in chat_log messages to participant id attribute" -- an instruction that structurally cannot resolve for any character line.

This is what makes a forwarded CHARACTER quote unable to carry a meaningful from_id (PR #2141): the correct value has no roster entry to point at. Fixing the roster is what makes the attribute worth emitting.

Scope guard from the owner: grab only characterInfo, NOT the full personality record. The roster is in every prompt, so bloating it costs tokens on every single turn -- pick the minimum that identifies the character to the model.

Fix shape: extend the participants section to include the personalities present in the window alongside personas, with an id the chat_log from_id can match. Decide whether characters and personas share one id space or get distinguishing markup -- they are different kinds of entity and the model should probably know which is which.

Acceptance: a character line in chat_log carries a from_id that resolves to a participants entry; the roster addition is bounded to characterInfo-sized fields; a token-cost comparison before/after is stated rather than assumed.
<!-- SECTION:DESCRIPTION:END -->
