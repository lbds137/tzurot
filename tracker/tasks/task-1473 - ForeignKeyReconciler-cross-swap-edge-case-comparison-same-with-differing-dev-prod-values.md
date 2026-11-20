---
id: TASK-1473
title: >-
  ForeignKeyReconciler cross-swap edge case: comparison same with differing
  dev/prod values
status: To Do
assignee: []
created_date: '2026-11-20T00:12:00Z'
labels:
  - area:db
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1473000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: docs/reference/architecture/epic-identity-hardening.md related-items note: the cross-swap case where the reconciler comparison says same but devValue differs from prodValue sat dormant before PR #813 and is reactivated for the default_persona_id / default_llm_config_id columns. Pointer orphaned by the BACKLOG.md retirement (PR 2772 review).
What: write the test that pins the case, then fix the handling or record a deliberate ruling-out with the reason.
Acceptance: the case is pinned by a test and either fixed or ruled out in a commit that names the reason.
<!-- SECTION:DESCRIPTION:END -->
