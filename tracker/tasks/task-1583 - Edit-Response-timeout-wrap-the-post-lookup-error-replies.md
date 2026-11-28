---
id: TASK-1583
title: 'Edit Response: timeout-wrap the post-lookup error replies'
status: To Do
assignee: []
created_date: '2026-11-28T04:21:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1573000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: in services/bot-client/src/commands/editResponse.ts execute(), the lookup-failure and TOO_LONG replies are bare replySpec calls after the awaited getEditableMessage gateway call. A lookup slower than 3s makes the reply throw, the catch replySpecSafe also hits an expired token, and the user sees nothing. The happy path is covered by showModalWithTimeoutCatch.
What: route those two error replies through a timeout-catch wrapper (the ackWithTimeoutCatch shape) so a blown budget degrades to a followUp.
Acceptance: a unit test with an expired-interaction mock shows the error reaching the user via followUp.
Source: TASK-1582 PR A self-review.
<!-- SECTION:DESCRIPTION:END -->
