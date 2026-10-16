---
id: TASK-1231
title: Reset BYOK lastUsedAt when a key is replaced (setKey upsert)
status: To Do
assignee: []
created_date: '2026-10-16 03:23'
updated_date: '2026-10-16 03:58'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1220000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2620 review round 2 finding 3. /settings apikey set upserts the key without touching lastUsedAt, so after a swap the browse view shows the OLD key validation time under the new Last validated label - the display asserts the current key was validated when it was not. The old Last used label hid this; the relabel makes it visible. Code-reading, not runtime-confirmed.

Owner ruling 2026-10-15 (AskUserQuestion): YES - null lastUsedAt on the update branch of setKey (new key shows Never until tested), one line plus a test, own small PR.

Original question (answered): null lastUsedAt on the update branch, or document the stale-timestamp display as intentional? Recommendation was reset - taken.
<!-- SECTION:DESCRIPTION:END -->
