---
id: TASK-561
title: >-
  Health webhook chunker: newline flattening, no 429 handling, no wait=true, no
  allowed_mentions
status: Done
assignee: []
created_date: '2026-08-12 22:33'
updated_date: '2026-08-13 23:11'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 561000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: all latent at current report sizes, all in the #2039 path. (1) splitMessage flattens EVERY internal newline for a blank-line-free block over 2000 chars (discord.ts:99-115 rejoins sentences/words with spaces) - and the health report bullet/advisory sections are exactly that shape, so the first oversized section posts as an unreadable run-on wall; the PR test corpus (space-separated tokens) structurally cannot catch newline loss. (2) postAllChunks POSTs back-to-back with no 429/Retry-After handling - a multi-chunk report can convert a transient throttle into a hard delivery failure with a swallowed trailer. (3) POST without ?wait=true means 204 is not message persistence or ordering confirmation (parity with the old curl, but the sequential-delivery guarantee rests on it). (4) payload sends no allowed_mentions suppression while the sibling bot path deliberately does (ownerChannel.ts).

Fix shape: line-aware split for line-oriented content (split on \n, never join across it), retry_after-aware retry or ~500ms inter-chunk sleep, ?wait=true, allowed_mentions: parse [].

Rider (same subsystem): health.ts:174-176 still says the measuredRef placement survives "the Discord step's sed-from-the-header slice and its head -c tail truncation" — #2039 deleted that shell block; slicing is now health-webhook-post.ts indexOf and there is no tail truncation. Fix the comment in the same PR (health-ci reviewer F4, CONFIRMED).

Acceptance: a newline-bearing oversized-section fixture survives chunking intact. Source: 2026-08-12 review (health-ci reviewer F1/F2/F3/F5).
<!-- SECTION:DESCRIPTION:END -->
