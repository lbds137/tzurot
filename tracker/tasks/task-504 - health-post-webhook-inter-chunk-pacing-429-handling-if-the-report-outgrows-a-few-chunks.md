---
id: TASK-504
title: >-
  health:post-webhook: inter-chunk pacing / 429 handling if the report outgrows
  a few chunks
status: To Do
assignee: []
created_date: '2026-08-10 11:30'
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
Acceptance: a 6+ chunk report delivers completely under the webhook rate limit; existing degrade/trailer tests stay green.
Promote when: the weekly report starts chunking past ~4 chunks (visible in the "Posted N chunk(s)" log line in the weekly-audit workflow), or a 429 appears in the workflow log.
<!-- SECTION:DESCRIPTION:END -->
