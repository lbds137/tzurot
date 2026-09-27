---
id: TASK-1127
title: Re-importing a character via /character import never applies the card isPublic
status: To Do
assignee: []
created_date: '2026-09-27 14:55'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PUT /api/user/personality/{slug} (update.ts buildUpdateData) does not forward isPublic, so a re-import into an existing slug (Discord /character import, and pnpm ops characters:import) silently keeps the stored visibility even when the card says otherwise. Pinned as current behavior by the update.test.ts test "absent card fields and isPublic are not written". characters:import reports it as "not applied by update".

What: decide whether an import update should write isPublic, then either forward it in buildUpdateData (and flip that test) or tell the user in the /character import reply that visibility was not changed.

Acceptance: a re-import either applies the card visibility or says it did not.

Owner question: should re-importing a card change the character visibility to match the card?
Recommendation: yes, forward isPublic on update. The card is the explicit statement of intent, and the dashboard toggle stays available afterwards.
<!-- SECTION:DESCRIPTION:END -->
