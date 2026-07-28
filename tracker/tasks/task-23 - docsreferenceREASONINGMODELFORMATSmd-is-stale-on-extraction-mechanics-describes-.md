---
id: TASK-23
title: REASONING_MODEL_FORMATS.md is stale on extraction mechanics
status: To Do
assignee: []
created_date: '2026-07-05 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:docs'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-05 — `docs/reference/REASONING_MODEL_FORMATS.md` is stale on extraction mechanics: describes the removed transport-layer body mutation (`interceptReasoningResponse` in ModelFactory); actual mechanism is `__includeRawResponse` + `extractOpenRouterReasoning.ts` post-parse. Also its o-series section describes deprecated models (the system→user transform is deleted per the prompt-assembly design). **Fix shape**: rewrite the mechanics section against current code; doc-only, direct develop commit fine. **Promote when**: next touching reasoning-extraction code, or a docs pass.

**Why:** A reference doc that misdescribes the live mechanism actively misleads debugging.
<!-- SECTION:DESCRIPTION:END -->
