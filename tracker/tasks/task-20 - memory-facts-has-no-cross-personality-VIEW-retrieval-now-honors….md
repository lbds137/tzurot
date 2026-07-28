---
id: TASK-20
title: '/memory facts: cross-personality view with per-character attribution'
status: To Do
assignee: []
created_date: '2026-07-10 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:bot-client'
  - 'area:api-gateway'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-10 — `/memory facts` has no cross-personality VIEW: retrieval now honors `shareLtmAcrossPersonalities` (facts+episodes parity, owner call) but browse still requires one personality. **Fix shape**: optional personality on GET /user/fact/list (persona-scoped is safe — you only ever see facts about you) + a browse "all characters" mode with per-character attribution on each row. **Promote when**: next `/memory` UI pass, or when the owner asks to see the whole fact picture.

**Why:** Sharing users can't audit what the flag actually exposes across characters.
<!-- SECTION:DESCRIPTION:END -->
