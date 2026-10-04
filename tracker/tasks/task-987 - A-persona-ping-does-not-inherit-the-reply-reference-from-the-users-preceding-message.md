---
id: TASK-987
title: >-
  A persona ping does not inherit the reply reference from the users preceding
  message
status: To Do
assignee: []
created_date: '2026-09-15 01:22'
updated_date: '2026-10-04 23:07'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 983000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed in production 2026-09-14 in a private channel. A user replied to an earlier message, then sent the persona ping as a SEPARATE follow-up message. The persona received no reference to the replied-to message, and another user in the channel had to explain the workaround out loud: tag the persona inside the reply itself. The friction is that Discord renders the reply indicator above the GROUPED message header, so the reply and the follow-up ping look like one gesture to the person sending them.

Mechanism (code-read, NOT runtime-confirmed): ReplyReferenceStrategy.extract reads message.reference?.messageId off the TRIGGERING message only - services/bot-client/src/handlers/references/strategies/ReplyReferenceStrategy.ts:25 - and MessageReferenceExtractor BFS-crawls outward from that single message. A reply carried by a different message than the mention therefore contributes nothing.

What is actually lost is the POINTER, not necessarily the text: in the observed case the persona still answered well, because the replied-to message was recent enough to sit in conversation history. The failure mode is worse when the reply target is older than the history window, or when several candidate messages make the referent ambiguous.

Acceptance: a reply-then-ping pair from one user in one channel produces the same referenced-message set as tagging the persona inside the reply; and a test pins that an older unrelated reply from the same user is NOT adopted.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-10-04 (AskUserQuestion, chose the recommendation): yes, narrowly: same author, same channel, only when the ping carries no reference of its own, look back about 3 messages and about 2 minutes.
<!-- SECTION:NOTES:END -->
