---
id: TASK-272
title: 'Allowlist-path perf polish (#1650 r3 nit, item 2 of 2)'
status: To Do
assignee: []
created_date: '2026-07-14 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'origin:review'
  - 'size:S'
  - 'state:observable'
  - 'area:common-types'
dependencies: []
priority: low
ordinal: 272000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Allowlist-path perf polish (#1650 r3 nit, item 2 of 2) — ~~(1) `atLimit` computed post-filter~~ SHIPPED #1662. Remaining: (2) `getOutboundDmAllowlist()` re-parses the env string per call — fine at once-per-request/broadcast cadence; add a module-level cache with a `resetConfig()`-style reset (the `getConfig()` pattern) if it ever moves into a hotter path. **Promote when**: the allowlist gate lands in a per-message path, or next `outboundDmAllowlist.ts` touch. Surfaced 2026-07-14 (#1650 review).

**Why:** Not-yet-hot path — polish, not a defect.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): NARROWED and relabelled. Item 1 shipped in #1662. Item 2's helper getOutboundDmAllowlist now lives in packages/common-types/src/utils/outboundDmAllowlist.ts and still re-parses env on every call; area label corrected to common-types.
---
<!-- COMMENTS:END -->
