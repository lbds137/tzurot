---
id: TASK-286
title: Notification-eligibility refinements beyond the deliberate-use gate
status: To Do
assignee: []
created_date: '2026-07-17 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 286000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-17 (community feedback, Mythica in Elephant in the Room; owner: "future refinement" / "under consideration") — Notification-eligibility refinements beyond the deliberate-use gate: (a) **activity recency** — limit release DMs to accounts with ≥X uses in the last Y days (UsageLog already carries the timestamps; dormant one-time users arguably shouldn't get DMs forever); (b) **interaction-surface relevance** — server-only users "might not care if you updated it, long as it works"; consider whether DM-usage should weight the default, or whether this is over-segmentation. Both are product-taste calls on top of the shipped gate, not correctness gaps — the current gate already fails toward the defensible audience. **Promote when**: post-beta.167 blast feedback suggests the ~117 audience is still too broad, or next notifications-eligibility touch.

**Why:** The incident fix drew the line at "real user"; these refine WHERE among real users the line sits — owner explicitly parked both for later.

Owner question: Do you want to narrow the release-DM audience now by (a) activity recency or (b) interaction-surface relevance, or leave the shipped deliberate-use gate as the whole rule?
Recommendation: Neither yet — keep filed, because the task records both as product-taste refinements rather than correctness gaps, notes the current gate already fails toward the defensible audience, and names its own trigger as post-blast feedback saying the audience is still too broad.

Decision 2026-09-02 (owner): keep the shipped deliberate-use gate as the whole rule; revisit only on post-blast feedback that the audience is still too broad.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. task already carries an explicit owner decision recorded 2026-09-02: keep the shipped deliberate-use gate as the whole rule, revisit only on post-blast feedback that the audience is still too broad. Nothing to re-derive from code — this is a live, correctly-dispositioned watch, not stale. Evidence: task file's own "Decision 2026-09-02 (owner)" note (read via `cat`, the file's full body — this is exactly the "rulings from earlier passes live as notes" case the spec calls out).
---
<!-- COMMENTS:END -->
