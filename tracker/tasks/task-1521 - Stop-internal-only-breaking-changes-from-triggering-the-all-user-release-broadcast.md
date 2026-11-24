---
id: TASK-1521
title: >-
  Stop internal-only breaking changes from triggering the all-user release
  broadcast
status: To Do
assignee: []
created_date: '2026-11-24T01:36:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1520000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: beta.249 DMed every default-level user because the notes put an internal column rename under Breaking Changes, which classifies the release as major (RELEASE_LEVEL_SECTIONS in common-types/constants/releaseNotes.ts; notifyLevel defaults to major, prisma/schema.prisma:43). The rename was invisible to users.

What (owner ruling 2026-11-23, Guard + rule): (1) the tzurot-git-workflow release section defines Breaking Changes as user-facing breaks only; internal breaks go under Database Migrations or deploy notes. (2) release:finalize refuses notes carrying a Breaking Changes section unless an explicit --broadcast-all flag confirms the all-user DM.

Acceptance: a probe run of release:finalize on notes with a Breaking Changes section exits non-zero without the flag and passes with it; the skill text states the definition.
<!-- SECTION:DESCRIPTION:END -->
