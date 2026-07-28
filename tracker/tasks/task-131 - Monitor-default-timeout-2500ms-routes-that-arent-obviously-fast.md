---
id: TASK-131
title: Monitor default-timeout (2500ms) routes that aren't obviously fast
status: To Do
assignee: []
created_date: '2026-05-30 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:embeddings'
  - 'area:db'
  - 'size:S'
dependencies: []
priority: low
ordinal: 131000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Monitor default-timeout (2500ms) routes that aren't obviously fast

**Why:** The timeout-regression fix (PR #1119) restored explicit `timeoutMs` on every route beta.125 had bumped and registered the rest in `DEFAULT_TIMEOUT_OK` (manifest.test.ts) as "fast, 2500ms is fine." A few in that allowlist are not _obviously_ fast and were never bumped in beta.125 (so not regressions, left as default): **`search`** (`POST /memory/search` — pgvector similarity: query embedding + vector scan, the slowest "fast" route), **`batchDelete`** / **`purge`** (`/memory/*` token-gated bulk destructive; the heavy counting is in `batchDeletePreview`, so the execute leg is likely bounded but unverified), **`clearHistory`** (`/history/clear` scoped delete-many). **Promote when**: any of these surfaces a real `HTTP 0` false-timeout, OR a handler read confirms the op can exceed 2500ms — then move it out of `DEFAULT_TIMEOUT_OK` and give it an explicit `timeoutMs` (DEFERRED). The allowlist registration already makes that a conscious change. Surfaced 2026-05-30 during the PR #1119 timeout audit. Deferred 2026-05-30.
<!-- SECTION:DESCRIPTION:END -->
