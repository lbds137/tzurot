---
id: TASK-1472
title: 'UserService singleton-hazard guard: shell-path cache omission'
status: To Do
assignee: []
created_date: '2026-11-20T00:12:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:observable
dependencies: []
priority: low
ordinal: 1472000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: docs/reference/architecture/epic-identity-hardening.md related-items note: if UserService is ever promoted to a singleton, the shell-path cache omission becomes a hazard and needs the guard (or a documented ruling-out). Pure conditional today - the signal arrives on its own.
What: on promotion, add the singleton-hazard guard for the shell-path cache or record why it is not needed.
Promote when: UserService is promoted to a singleton.
<!-- SECTION:DESCRIPTION:END -->
