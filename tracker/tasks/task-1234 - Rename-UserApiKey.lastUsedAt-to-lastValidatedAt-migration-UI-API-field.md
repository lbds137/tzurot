---
id: TASK-1234
title: Rename UserApiKey.lastUsedAt to lastValidatedAt (migration + UI + API field)
status: To Do
assignee: []
created_date: '2026-10-16 05:53'
updated_date: '2026-10-16 05:56'
labels:
  - 'area:api-gateway'
  - 'area:db'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 1222000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2623 review round 3 finding 5. The column now strictly means last-validated (setKey stamps at set, testKey at test; generation never stamps it), and only the UI label papers over the drift. A rename (lastValidatedAt) is a migration + schema + WalletKey schema field + api-gateway routes + any ai-worker reads; the field name is API-visible (wallet listKeys response).

Owner question: is the naming drift worth a schema migration and an API field rename, or does the UI label plus the schema doc comment cover it?

Recommendation: keep the name - the migration + API-visible field change buys clarity for one internal table; the schema comment and the UI label already state the semantics. Revisit only if another lastUsedAt consumer appears.
<!-- SECTION:DESCRIPTION:END -->
