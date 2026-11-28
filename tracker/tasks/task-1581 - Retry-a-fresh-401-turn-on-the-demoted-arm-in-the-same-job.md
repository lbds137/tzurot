---
id: TASK-1581
title: Retry a fresh-401 turn on the demoted arm in the same job
status: To Do
assignee: []
created_date: '2026-11-28T00:12:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1571000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: while an invalid-key mark is live, no request touches the user key, so nothing refreshes the mark. At TTL expiry the next request runs the dead key, fails that turn outright (AUTHENTICATION is non-retargetable), and only then rewrites the mark - one failed reply per 10-minute window until the user fixes the key. Review cycle 7 on PR 2829.

Fix shape: after a fresh 401 writes the mark, retry the request once on the demoted arm in the same job; alternatively accept and document the one-failed-turn-per-window behaviour in the KeyInvalidCache header.

Acceptance: a marked key never costs a full failed reply more than once per fix cycle; or the per-window failure is documented as accepted with the reason.
<!-- SECTION:DESCRIPTION:END -->
