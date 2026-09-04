---
id: TASK-31
title: 'Vision error-pattern recall: watch for unanchored provider phrasings'
status: To Do
assignee: []
created_date: '2026-07-02 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Vision error-pattern recall: watch for unanchored provider phrasings

**Why:** The ERROR_DESCRIPTION_PATTERNS tightening traded recall for precision — an error phrased outside the anchors (e.g. "I don't have access to any image URL") now positively caches as a "valid" description for the 1h VISION_DESCRIPTION_TTL, blocking retries for that window. Acceptable (fixes a real currently-firing false positive; blast radius is one TTL). **Promote when**: a prod log shows an error-shaped description that `isLikelyErrorDescription` missed — add its phrasing to the anchored list in `visionDescriptionValidity.ts`. Surfaced 2026-07-02 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `ERROR_DESCRIPTION_PATTERNS` / `isLikelyErrorDescription` still live in `visionDescriptionValidity.ts`, unchanged shape. Watch's observable (a prod log showing an error-shaped description that slipped past the check) is still reachable and hasn't fired. Evidence: `git grep -n "ERROR_DESCRIPTION_PATTERNS|isLikelyErrorDescription" -- services/ai-worker/src` → both present, referenced from `visionDescribeGates.ts` and tested in `visionDescriptionValidity.test.ts`.
---
<!-- COMMENTS:END -->
