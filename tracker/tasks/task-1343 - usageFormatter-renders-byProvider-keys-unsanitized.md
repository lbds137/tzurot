---
id: TASK-1343
title: usageFormatter renders byProvider keys unsanitized
status: To Do
assignee: []
created_date: '2026-11-03T00:16:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1326000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/utils/usageFormatter.ts renders **provider** from byProvider keys with no sanitizer, beside the byModel line that #2706 fixed. Provider is free text in the /preset modal, so if those keys come from it, a bare URL or masked link renders in the admin usage view. Unverified: where the keys originate.

What: read the producer of byProvider. If owner free text can reach it, render through sanitizeModelIdForDisplay with a test. If only canonical enums can, say so in a one-line comment.

Acceptance: the origin is stated, and a hostile key cannot render a link, pinned by a test if reachable.

Provenance: claude-review round 3 on #2706.
<!-- SECTION:DESCRIPTION:END -->
