---
id: TASK-1479
title: voice-resolution reads a private character without a visibility check
status: Done
assignee: []
created_date: '2026-11-20T06:36:00Z'
updated_date: '2026-11-22T04:53:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1479000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: GET /user/voice-resolution looks up the personality with findFirst by id and no owner or public filter, so any provisioned user holding the UUID can read the name and (since PR 2773) voiceEnabled of a private character. Low impact (UUIDs are hard to guess) but a data-visibility gap.
What: compare with how other per-personality user routes enforce visibility and match them; add a test that a private character owned by someone else returns 404.
Acceptance: a non-owner cannot resolve a private character; the test pins it.
<!-- SECTION:DESCRIPTION:END -->
