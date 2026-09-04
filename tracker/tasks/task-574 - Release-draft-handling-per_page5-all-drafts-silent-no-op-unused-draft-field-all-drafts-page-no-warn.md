---
id: TASK-574
title: >-
  Release draft handling: per_page=5 all-drafts silent no-op, unused draft
  field, all-drafts page no warn
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 574000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three sibling gaps in the release scanners. (1) ReleaseFlagNagScheduler.ts:47-70 fetches per_page=5 ordered by creation incl. drafts (token set); if the 5 newest-created are all unpublished, newestPublishedRelease returns null and the check passes SILENTLY while the real newest published release sits flagged - failure mode of absorption is a silent pass, not a conservative one. (2) The schema declares draft: z.boolean() required but nothing reads it - exclusion rides entirely on published_at null, and whether a reverted-to-draft release retains published_at is unverified; one && !release.draft closes it. (3) releaseReconcile.ts:147-171 coverage tripwire filters null published_at, so a full page of drafts produces no warn (needs 30 drafts - negligible, noted for completeness).

Fix shape: check the draft field; warn on zero-published-in-page.

Source: 2026-08-12 review, health F6/F7 PLAUSIBLE + gateway LOW-3 CONFIRMED-mechanism.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Item 2 (declared-but-unread `draft` field) is confirmed still open in the now-shared `newestPublishedRelease` helper; item 1's tradeoff is now documented in a comment but functionally unchanged. Evidence: `sed -n '1,40p' packages/common-types/src/schemas/github/release.ts` → `newestPublishedRelease` filters purely on `published_at`; `draft` is declared on `GitHubReleaseSchema` but never read in the filter.
---
<!-- COMMENTS:END -->
