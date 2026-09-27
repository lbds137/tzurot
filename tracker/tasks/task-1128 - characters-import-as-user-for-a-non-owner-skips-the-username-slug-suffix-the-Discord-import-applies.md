---
id: TASK-1128
title: >-
  characters:import --as-user for a non-owner skips the -username slug suffix
  the Discord import applies
status: To Do
assignee: []
created_date: '2026-09-27 14:55'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /character import runs normalizeSlugForUser (common-types slugUtils), which appends a sanitized Discord username for non-owners. pnpm ops characters:import uses the card slug verbatim and has no real username (its UserClient identity is synthetic), so an --as-user import for a non-owner creates slugs the Discord path could not.

What: either resolve the acting user username from the gateway and apply normalizeSlugForUser, or refuse --as-user for a non-owner with a clear message.

Acceptance: a non-owner --as-user run either produces the same slug the Discord command would, or refuses up front. Owner-only use (the default) is unaffected today.
<!-- SECTION:DESCRIPTION:END -->
