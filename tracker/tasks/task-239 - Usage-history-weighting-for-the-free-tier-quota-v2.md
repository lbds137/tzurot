---
id: TASK-239
title: Usage-history weighting for the free-tier quota (v2)
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:ai-worker'
  - 'size:M'
dependencies: []
priority: low
ordinal: 239000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Usage-history weighting for the free-tier quota (v2) — `FreeTierRequestQuota` v1 divides the window budget equally among concurrent users (clamped). Owner floated ("maybe") weighting by usage history so habitual light users get more headroom and heavy users throttle first. Council: defer — minimal form is a per-user EWMA multiplier on the window cap, needs an extra keyspace + a population-mean approximation. **Promote when**: the flat rolling cap proves too blunt in practice. Surfaced 2026-07-08 (free-tier-quota build).

**Why:** Fairness refinement; not needed to fix the starvation the v1 addresses.
<!-- SECTION:DESCRIPTION:END -->
