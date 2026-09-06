---
id: TASK-903
title: >-
  Warn when archiveSplitRenderPersonalities lists a slug that matches no
  personality
status: To Do
assignee: []
created_date: '2026-09-06 17:31'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 901000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the list control (PR #2350) accepts any non-empty string; a typo in /admin settings set or the dashboard modal silently no-ops because the per-turn inclusion check in stampArchiveRenderMode (services/ai-worker/src/services/factRetrievalHelper.ts) never matches. Reviewer finding, round 1, Low.
Fix shape: at the two write paths that share parseSlugList (services/bot-client/src/commands/admin/settingsSet.ts and settingsSystemUpdate.ts), resolve each slug through the existing personality lookup the /character commands use and append a soft warning line for any that resolve to nothing; do not reject, to stay consistent with the no-cross-checks posture of the other controls. One unit test per write path with a mocked lookup.
Acceptance: setting the list to a real slug plus a typo saves both and shows one warning naming the typo.
<!-- SECTION:DESCRIPTION:END -->
