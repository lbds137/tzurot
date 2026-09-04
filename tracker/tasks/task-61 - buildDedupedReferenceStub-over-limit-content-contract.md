---
id: TASK-61
title: buildDedupedReferenceStub over-limit content contract
status: To Do
assignee: []
created_date: '2026-06-17 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:bot-client'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`buildDedupedReferenceStub` over-limit content contract

**Why:** `buildDedupedReferenceStub` returns `content` that can EXCEED `DEDUP_STUB_CONTENT` when attachment markers are present (markers are prepended AFTER the text is truncated), relying on `formatDedupedQuote` to re-apply the limit downstream. Safe today — every live render path (ai-worker `ReferencedMessageFormatter` + `xmlMetadataFormatters`; bot-client `ReferenceFormatter` ships stubs to the worker) goes through `formatDedupedQuote`, and the JSDoc documents the contract. **Promote when**: a new caller reads `stub.content` directly (logging, debugging, a new render path) without re-truncating → make the truncation self-contained inside `buildDedupedReferenceStub` (apply the combined limit there) or accept a `renderContentFn`. Surfaced by PR #1242 claude-review (rounds 3-4). Deferred 2026-06-17.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): RETARGET. buildDedupedReferenceStub and formatDedupedQuote are gone (7fd2dec25). The same shape lives in services/ai-worker/src/services/prompt/RenderableReference.ts: dedupeReference caps the preview via capDedupText and THEN prepends the marker prefix, so content can still exceed TEXT_LIMITS.DEDUP_STUB_CONTENT. Worse than filed: the old downstream re-cap (formatDedupedQuote) is gone too and renderReference emits ref.content raw. Fix shape unchanged: fold the marker into the capped budget.
---
<!-- COMMENTS:END -->
