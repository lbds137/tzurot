---
id: TASK-240
title: Sybil / alt-account dilution guard for the free-tier quota (v2)
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
ordinal: 240000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Sybil / alt-account dilution guard for the free-tier quota (v2) — `N` (rolling active-user count) is inflatable by alt accounts — cheap on Discord — shrinking every legit user's share and draining the shared key across sock-puppets. v1 has no cost-of-entry bound. **Fix shape**: a per-guild distinct-free-user cap, or tie eligibility to account age/membership. **Promote when**: alt-account budget-draining is observed. Surfaced 2026-07-08 (Kimi council, free-tier-quota build).

**Why:** Abuse-resistance; the primary single-heavy-user vector IS bounded by v1.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:54
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-18 (Theme Quota Billing Key Identity); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-240 finds it.
---
<!-- COMMENTS:END -->
