---
id: TASK-599
title: 'Prepare the batched owner-decision digest over the state:owner pool'
status: To Do
assignee: []
created_date: '2026-08-14 01:05'
labels:
  - 'area:backlog'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 599000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 45 open tasks carry state:owner — 14 percent of the board, and the single largest block that cannot move without the owner. They are parked precisely because they are the judgment calls (product taste, user-visible behavior, security/data). The agent can drain everything else around them indefinitely and the number will not fall. Owner APPROVED this pass on 2026-08-13, adding that the council is available for any decision the owner is unsure about.

What: read all 45, group them by theme rather than by filing order, and produce ONE digest the owner can clear in a single sitting instead of 45 separate interruptions. Each entry carries: the decision stated as one question, the options, a RECOMMENDED answer with its reason, and the blast radius if it goes the other way. Entries whose answer is genuinely uncertain get flagged as council candidates rather than padded with a weak recommendation — the owner named the council as the escape valve for exactly those.

Delivery shape is open and part of the scoping: a markdown digest, a sequence of AskUserQuestion batches, or a mix. AskUserQuestion caps at 4 questions per call, so 45 items means a dozen-plus calls if done purely that way — likely a written digest first, with AskUserQuestion reserved for the ones where structured options genuinely help.

Acceptance: every state:owner task appears exactly once in the digest with a stated question and a recommendation or a council flag; after the owner answers, each decision lands on its task file (not only in chat) and the tasks move off state:owner to whatever their answer implies.

Note: assistant-generated process work, owner-approved — counts against the session net.
<!-- SECTION:DESCRIPTION:END -->
