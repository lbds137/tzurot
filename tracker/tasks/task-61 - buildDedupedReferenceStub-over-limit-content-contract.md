---
id: TASK-61
title: buildDedupedReferenceStub over-limit content contract
status: To Do
assignee: []
created_date: '2026-06-17 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:bot-client'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`buildDedupedReferenceStub` over-limit content contract

**Why:** `buildDedupedReferenceStub` returns `content` that can EXCEED `DEDUP_STUB_CONTENT` when attachment markers are present (markers are prepended AFTER the text is truncated), relying on `formatDedupedQuote` to re-apply the limit downstream. Safe today — every live render path (ai-worker `ReferencedMessageFormatter` + `xmlMetadataFormatters`; bot-client `ReferenceFormatter` ships stubs to the worker) goes through `formatDedupedQuote`, and the JSDoc documents the contract. **Promote when**: a new caller reads `stub.content` directly (logging, debugging, a new render path) without re-truncating → make the truncation self-contained inside `buildDedupedReferenceStub` (apply the combined limit there) or accept a `renderContentFn`. Surfaced by PR #1242 claude-review (rounds 3-4). Deferred 2026-06-17.
<!-- SECTION:DESCRIPTION:END -->
