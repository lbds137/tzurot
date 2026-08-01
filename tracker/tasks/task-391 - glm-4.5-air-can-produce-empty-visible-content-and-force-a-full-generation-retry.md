---
id: TASK-391
title: >-
  glm-4.5-air can produce empty visible content and force a full generation
  retry
status: To Do
assignee: []
created_date: '2026-08-01 17:32'
updated_date: '2026-08-01 17:32'
labels:
  - 'size:M'
  - 'area:ai-worker'
dependencies: []
priority: medium
ordinal: 391000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced 2026-08-01 by the TASK-375 prod log sweep (10 ai-worker deployments, 36,094 lines, 374 generations).

**Observed**: 2 of 374 generations (~0.5%) ended in `Empty response after post-processing. Retrying...`, both `modelUsed="glm-4.5-air"`. Both were preceded by `Empty visible content - model only produced reasoning` — the model emitted a reasoning block terminated by a bare `</think>` and no answer at all, so `extractOrphanClosingTag` correctly filed the whole body as thinking and left `visibleLength=0`.

**Cost**: one measured instance spent `durationMs=41371` on the first attempt before the retry, against a 3-attempt budget. A second case landed `visibleLength=1`, which is degenerate rather than empty and does NOT trip the retry — it delivers a one-character reply to the user.

**Correlated signal**: 2 of the 3 also tripped `DuplicateDetection` with `similarity="0.996"` (stop-token failure, e.g. originalLength=3359 deduplicatedLength=1687). Whether that is the same root cause or a second glm-4.5-air quirk is unestablished.

**Not a regression and not the orphan extractors fault** — the extractor did the right thing with what it got. This is a model-quality issue on a free-tier model we keep deliberately.

**Fix shape (needs a decision, not just code)**: options are (a) leave it, the retry already recovers; (b) treat empty-visible-with-reasoning as a fast retry that skips the remaining backoff, since the outcome is known-bad the moment it is detected; (c) surface the reasoning as the reply when all attempts come back empty, rather than failing. The `visibleLength=1` case suggests any threshold should be a minimum length, not an emptiness check.

**Verify before building**: 2 events is a thin base rate. Re-grep a wider window for `Empty response after post-processing` and confirm the glm-4.5-air concentration holds before sizing this.
<!-- SECTION:DESCRIPTION:END -->
