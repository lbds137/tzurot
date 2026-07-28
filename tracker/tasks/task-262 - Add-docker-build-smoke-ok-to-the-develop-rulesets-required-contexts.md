---
id: TASK-262
title: Add docker-build-smoke-ok to the develop ruleset's required contexts
status: To Do
assignee: []
created_date: '2026-07-13 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'origin:review'
  - 'area:ci'
  - 'size:S'
dependencies: []
priority: low
ordinal: 262000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Add `docker-build-smoke-ok` to the develop ruleset's required contexts — The join job exists precisely to be ONE stable required-check name over the four matrix legs; until it's in the ruleset, a red smoke build blocks only by house rule (attention), not structurally. **Fix shape**: owner dashboard action — Settings → Rules → develop ruleset → add `docker-build-smoke-ok`. **Promote when**: next ruleset touch (or immediately — 30 seconds). Surfaced 2026-07-13 (#1640 review).

**Why:** Structural teeth for the new gate; one dashboard click.
<!-- SECTION:DESCRIPTION:END -->
