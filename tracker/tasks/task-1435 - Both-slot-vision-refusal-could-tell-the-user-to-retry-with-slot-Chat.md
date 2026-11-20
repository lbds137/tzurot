---
id: TASK-1435
title: Both-slot vision refusal could tell the user to retry with slot Chat
status: To Do
assignee: []
created_date: '2026-11-17T13:18:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1435000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: from PR 2759 claude-review r2. Picking slot Both with a text-only preset (on /preset override set, /preset default set, the global default setters) is refused whole by the gateway vision gate (services/api-gateway/src/routes/user/model-override.ts, grep ensureVisionCapableModel), which is the correct fail-closed behaviour, but the generic message does not say the user can rerun with slot Chat to pin just the chat side.

What: one shared change across every Both site: when the request slot is both and the vision gate refuses, append a short next step (retry with slot Chat). User-visible copy, so the wording is the owner call.

Owner question: Should a refused Both request add a hint to retry with slot Chat?
Recommendation: Yes, one sentence appended to the existing refusal on all Both sites. It turns a dead end into a one-step fix.

Acceptance: every Both-capable setter shows the hint on a vision-gate refusal; single-slot vision refusals unchanged; tests pin both.
Owner ruling (2026-11-20, AUQ): yes, append the retry-with-slot-Chat hint on every Both refusal site (the recommendation).
<!-- SECTION:DESCRIPTION:END -->
