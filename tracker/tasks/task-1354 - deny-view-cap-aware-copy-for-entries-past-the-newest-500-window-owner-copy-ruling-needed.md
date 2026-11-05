---
id: TASK-1354
title: >-
  /deny view: cap-aware copy for entries past the newest-500 window (owner copy
  ruling needed)
status: Done
assignee: []
created_date: '2026-11-05T00:26:00Z'
updated_date: '2026-11-05T04:12:00Z'
labels:
  - area:bot-client
  - size:S
  - state:owner
dependencies: []
priority: low
ordinal: 1337000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review round 3 on PR 2717, finding 1 (Medium). Pre-existing behavior the PR documented in its body: /deny view resolves against the same capped listDenylistEntries fetch as browse, so a target older than the newest 500 entries gets the confident false negative: No denylist entries found for <id>. (view.ts:53-56). Reviewer suggests cap-aware copy in the COULD_NOT_VERIFY_NOTE wording family instead, pinned by an at-cap test. Same TASK-1294 class (cap invisibility) on a sibling surface. Needs an owner ruling on the exact wording before implementing.

Owner question: Adopt cap-aware copy on /deny view for past-cap misses — reviewer wording family: "Couldn't find <id> in the newest 500 entries - if it still exists, remove it with /deny remove"?

Recommendation: yes — the false not-found is the exact confusion TASK-1294 ruled to fix; one small copy + test change; ride it with the COULD_NOT_VERIFY_NOTE reword ask (TASK-1303 surface).
<!-- SECTION:DESCRIPTION:END -->
