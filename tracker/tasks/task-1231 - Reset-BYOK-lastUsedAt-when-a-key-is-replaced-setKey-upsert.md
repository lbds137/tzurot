---
id: TASK-1231
title: Reset BYOK lastUsedAt when a key is replaced (setKey upsert)
status: To Do
assignee: []
created_date: '2026-10-16 03:23'
updated_date: '2026-10-16 05:03'
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
Why: PR #2620 review round 2 finding 3. /settings apikey set upserts the key without touching lastUsedAt, so after a swap the browse view shows the OLD key validation time under the new Last validated label. Code-reading, not runtime-confirmed.

Owner ruling 2026-10-15 (AskUserQuestion): YES to reset (null on update branch).

SUPERSEDED 2026-10-16 (owner chose Stamp at set, new information): reading the code for the fix showed setKey ALREADY validates the new key with the provider (same validateApiKey as /test, returns credits) - nulling would show Never for a key that was just proven working. Fix = stamp lastUsedAt: new Date() on BOTH upsert branches, so the label is true at every moment. Shipped as the fix/byok-setkey-validates-stamp PR.
<!-- SECTION:DESCRIPTION:END -->
