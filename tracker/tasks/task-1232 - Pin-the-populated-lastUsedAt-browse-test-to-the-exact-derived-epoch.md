---
id: TASK-1232
title: Pin the populated-lastUsedAt browse test to the exact derived epoch
status: To Do
assignee: []
created_date: '2026-10-16 04:09'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1220000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #2620 review round 4 finding 3 (optional): the populated-branch test asserts /Last validated <t:\d+:R>/ which cannot distinguish lastUsedAt from createdAt (both render <t:N:R> - only the :D style differs, and createdAt renders :D). Assert the exact epoch (fixture 2025-01-15T12:00:00Z -> 1736942400) so a field swap fails the test.
<!-- SECTION:DESCRIPTION:END -->
