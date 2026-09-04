---
id: TASK-259
title: Shapes.inc resume-from-page for mid-job cookie expiry
status: To Do
assignee: []
created_date: '2026-04-22 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 259000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Shapes.inc resume-from-page for mid-job cookie expiry — The one residual of the fetcher-hardening theme (closed 2026-07-13, #1630/#1631 + docs): a session cookie expiring mid-export currently fails the job and a re-run restarts from page 1. True resume needs partial-progress persistence, a resume-point in job data, and re-submit UX — a real feature, deliberately not built as hardening. The diagnostic half shipped: mid-job 401s report the exact page (`[memories traversal stopped at page N]`), which doubles as the tripwire. **Fix shape**: persist fetched pages (or page cursor) on the export row, accept a resume-from field, re-enter the traversal loop at that page. **Promote when**: a mid-job 401 with a page stamp is actually observed in prod logs (Better Auth sessions last ~7 days vs minutes-long jobs, so this should be rare). Surfaced 2026-04-22 (hardening proposal item 6b); filed at theme close-out 2026-07-13.

**Why:** The page-stamped error message is the evidence-gate for building this.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. The diagnostic half (`[memories traversal stopped at page N]`) is still the only thing shipped; no resume-from-page/partial-progress persistence exists in `ShapesDataFetcher.ts`. Promote trigger (an actual mid-job 401 with a page stamp observed in prod) can't be verified from a code-only pass, so this stays a valid, low-probability watch per the task's own reasoning (Better Auth sessions last ~7 days vs. minutes-long jobs). Evidence: `git grep -n "memories traversal stopped at page|resumeFrom" services/ai-worker/src` → only the diagnostic message exists, no resume logic.
---
<!-- COMMENTS:END -->
