---
id: TASK-256
title: >-
  Settings dashboard page-jump select (7 pages via prev/next is walkable but
  clicky)
status: To Do
assignee: []
created_date: '2026-07-13 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 256000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Settings dashboard page-jump select (7 pages via prev/next is walkable but clicky) — The paged settings dashboards (admin: 7 pages, defaults: 3) navigate only by ◀/▶ one page at a time. A page-jump select menu row (one option per page label) would cut worst-case clicks from 6 to 1 on the admin dashboard. Deliberately deferred from admin-runtime PR 2 — prev/next is fully functional and the extra select row costs a component slot on every overview render. **Fix shape**: optional second select row (or replace the indicator button) listing page labels, routed via a `page::…::jump` customId. **Promote when**: owner friction report, or an 8th page joins the dashboard. Surfaced 2026-07-13 (admin-runtime PR 2 plan).

**Why:** UX polish gated on real friction; mechanism supports it cheaply.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `settingsButtonBuilders.ts` still builds only a ◀ Prev / indicator / Next ▶ row (no page-jump select). Deliberately deferred UX polish; promote-when (owner friction report, or an 8th page) hasn't fired. Evidence: `git grep -n "◀\|▶"` in `utils/dashboard/settings/settingsButtonBuilders.ts` → confirmed prev/next-only row, comment at line 111-112 describes exactly this shape.
---
<!-- COMMENTS:END -->
