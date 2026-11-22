---
id: TASK-1234
title: Rename UserApiKey.lastUsedAt to lastValidatedAt (migration + UI + API field)
status: Done
assignee: []
created_date: 2026-10-16 05:53
updated_date: '2026-11-22T17:58:00Z'
labels:
  - area:api-gateway
  - area:db
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1222000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2623 review round 3 finding 5. The column now strictly means last-validated (setKey stamps at set, testKey at test; generation never stamps it), and only the UI label papers over the drift. A rename (lastValidatedAt) is a migration + schema + WalletKey schema field + api-gateway routes + any ai-worker reads; the field name is API-visible (wallet listKeys response).

Owner question: is the naming drift worth a schema migration and an API field rename, or does the UI label plus the schema doc comment cover it?

Recommendation: keep the name - the migration + API-visible field change buys clarity for one internal table; the schema comment and the UI label already state the semantics. Revisit only if another lastUsedAt consumer appears.
Owner ruling (2026-11-20, AUQ): RENAME to lastValidatedAt (against the keep-the-name recommendation): migration + UI + API field rename.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner ruling (2026-11-22, AUQ): real column rename last_used_at -> last_validated_at; beta.249 deploys inside a prod maintenance window (destructive migration path: maintenance on -> release:premigrate --allow-destructive -> merge -> maintenance off). Scope excludes the shapes credential lastUsedAt (genuinely last-used, stamped by shapes/list.ts).

Shipped in PR #2787 (merged 2026-11-22); dev migrated. Prod needs the maintenance window at beta.249 (backlog/now.md deploy notes).
<!-- SECTION:NOTES:END -->
