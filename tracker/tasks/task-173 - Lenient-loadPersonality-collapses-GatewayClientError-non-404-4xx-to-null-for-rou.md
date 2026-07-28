---
id: TASK-173
title: >-
  Lenient loadPersonality collapses GatewayClientError (non-404 4xx) to null for
  routing
status: To Do
assignee: []
created_date: '2026-06-25 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 173000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Lenient `loadPersonality` collapses `GatewayClientError` (non-404 4xx) to null for routing

**Why:** `HttpPersonalityLoader.loadPersonality` (the routing/mention-parsing wrapper) catches BOTH `InfraError` and `GatewayClientError` and returns `null` ("treat unknown as no-match"). A 403 Forbidden means "the character exists but access is denied" — collapsing it to "no match" is correct for routing today (you can't use a character you can't access), but the wrapper has discarded the exists-but-forbidden vs. doesn't-exist distinction. Not a bug; a lost signal. **Fix shape (only if needed)**: have the wrapper re-raise or tag `GatewayClientError` so a routing caller that needs to differentiate can. **Promote when**: a routing/mention path needs to separate "forbidden" from "absent". Surfaced 2026-06-25 by the beta.137 release review (#1338).
<!-- SECTION:DESCRIPTION:END -->
