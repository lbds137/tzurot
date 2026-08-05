---
id: TASK-215
title: shortModelName merges different models sharing a trailing path segment
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'origin:review'
  - 'area:api-gateway'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 215000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`shortModelName` merges different models sharing a trailing path segment

**Why:** `/usage` byModel now keys on the last `/` segment, so hypothetical `providerA/turbo` + `providerB/turbo` would merge into one row — the guarantee is "same trailing segment," not "same model." Accepted tradeoff for the real z-ai/openrouter duplication; no known colliding pair today. **Fix shape** (if ever needed): key on `(shortName)` but display provider list per row, or maintain a curated alias map. **Promote when**: a real cross-provider name collision shows up in /usage. Surfaced 2026-07-06 (beta.149 release review).
<!-- SECTION:DESCRIPTION:END -->
