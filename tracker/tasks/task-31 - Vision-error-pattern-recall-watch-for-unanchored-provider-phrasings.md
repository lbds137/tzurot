---
id: TASK-31
title: 'Vision error-pattern recall: watch for unanchored provider phrasings'
status: To Do
assignee: []
created_date: '2026-07-02 00:00'
updated_date: '2026-07-28 10:46'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: low
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Vision error-pattern recall: watch for unanchored provider phrasings

**Why:** The ERROR_DESCRIPTION_PATTERNS tightening traded recall for precision — an error phrased outside the anchors (e.g. "I don't have access to any image URL") now positively caches as a "valid" description for the 1h VISION_DESCRIPTION_TTL, blocking retries for that window. Acceptable (fixes a real currently-firing false positive; blast radius is one TTL). **Promote when**: a prod log shows an error-shaped description that `isLikelyErrorDescription` missed — add its phrasing to the anchored list in `visionDescriptionValidity.ts`. Surfaced 2026-07-02 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
