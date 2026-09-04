---
id: TASK-239
title: Usage-history weighting for the free-tier quota (v2)
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-09-04 19:54'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 239000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Usage-history weighting for the free-tier quota (v2) — `FreeTierRequestQuota` v1 divides the window budget equally among concurrent users (clamped). Owner floated ("maybe") weighting by usage history so habitual light users get more headroom and heavy users throttle first. Council: defer — minimal form is a per-user EWMA multiplier on the window cap, needs an extra keyspace + a population-mean approximation. **Promote when**: the flat rolling cap proves too blunt in practice. Surfaced 2026-07-08 (free-tier-quota build).

**Why:** Fairness refinement; not needed to fix the starvation the v1 addresses.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:54
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-18 (Theme Quota Billing Key Identity); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-239 finds it.
---
<!-- COMMENTS:END -->
