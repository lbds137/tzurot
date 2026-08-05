---
id: TASK-286
title: Notification-eligibility refinements beyond the deliberate-use gate
status: To Do
assignee: []
created_date: '2026-07-17 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 286000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-17 (community feedback, Mythica in Elephant in the Room; owner: "future refinement" / "under consideration") — Notification-eligibility refinements beyond the deliberate-use gate: (a) **activity recency** — limit release DMs to accounts with ≥X uses in the last Y days (UsageLog already carries the timestamps; dormant one-time users arguably shouldn't get DMs forever); (b) **interaction-surface relevance** — server-only users "might not care if you updated it, long as it works"; consider whether DM-usage should weight the default, or whether this is over-segmentation. Both are product-taste calls on top of the shipped gate, not correctness gaps — the current gate already fails toward the defensible audience. **Promote when**: post-beta.167 blast feedback suggests the ~117 audience is still too broad, or next notifications-eligibility touch.

**Why:** The incident fix drew the line at "real user"; these refine WHERE among real users the line sits — owner explicitly parked both for later.
<!-- SECTION:DESCRIPTION:END -->
