---
id: TASK-504
title: >-
  health:post-webhook: inter-chunk pacing / 429 handling if the report outgrows
  a few chunks
status: To Do
assignee: []
created_date: '2026-08-10 11:30'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 504000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: chunks POST back-to-back with no delay. Discord webhook rate limits (~5 req/2s per webhook) mean a report that grows to 5+ chunks in one send could start tripping 429s, aborting the tail of the send (the INCOMPLETE trailer would fire, so the failure is at least visible). Raised twice by the #2039 reviews; retry/backoff machinery was deliberately declined at current sizes (2-4 chunks weekly).
Fix shape: a small fixed delay (300-500ms) between chunk POSTs, or honor the 429 retry-after header with one retry. Keep the trailer semantics.

Two same-file members from the #2039 round-3 review ride this touch (each too small to earn its own CI cycle, all in postChunk/runHealthWebhookPost):
- Whitespace-only report bypasses the empty degrade: splitMessage returns a single whitespace chunk for a truthy all-whitespace file, which then POSTs blank. Guard with sliced.trim().length check.
- postChunk fetch has no AbortController timeout; a hung request blocks until the job-level 30-min timeout instead of failing fast into the trailer path.

Acceptance: a 6+ chunk report delivers completely under the webhook rate limit; whitespace-only report is a no-post degrade; postChunk fails fast on a hung fetch; existing degrade/trailer tests stay green.
Promote when: the weekly report starts chunking past ~4 chunks (visible in the "Posted N chunk(s)" log line in the weekly-audit workflow), or a 429 appears in the workflow log.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): NARROWED. Two of three items shipped in 8c481e088 (429 retry honouring Retry-After; whitespace-only chunk degrade). Remaining: postChunk's bare fetch has no AbortController timeout, so a hung request eats the full 30-minute job timeout.
---
<!-- COMMENTS:END -->
