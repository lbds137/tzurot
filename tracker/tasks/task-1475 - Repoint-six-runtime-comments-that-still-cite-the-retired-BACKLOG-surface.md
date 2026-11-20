---
id: TASK-1475
title: Repoint six runtime comments that still cite the retired BACKLOG surface
status: To Do
assignee: []
created_date: '2026-11-20T05:08:00Z'
labels:
  - area:repo
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1475000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2772 retired the root BACKLOG.md manifest. Six comments in runtime code still route the reader to BACKLOG, a surface that no longer exists, so each names a tracked item nobody can find. Kept out of PR 2772 because that PR is process work and touches no runtime logic.

What: for each site, find the item the comment meant (`git log -S` on the comment, `pnpm tracker task list -s "To Do" --search` on its subject) and replace the pointer with its TASK-N or doc-N; if the item shipped or never existed, rewrite the comment to state the invariant with no pointer. Sites (`git grep -n BACKLOG -- services`, 2026-11-20):
- services/ai-worker/src/utils/safeExternalFetch.ts:25 and :40 ("tracked in BACKLOG")
- services/ai-worker/src/utils/attachmentFetch.ts:196 ("BACKLOG entry ships")
- services/ai-worker/src/utils/thinkingExtraction.test.ts:1333 ("the BACKLOG entry GLM-family")
- services/bot-client/src/commands/character/dashboard.ts:264 ("see BACKLOG Production Issue")
- services/bot-client/src/commands/preset/dashboardButtons.test.ts:536 ("BACKLOG 2026-04-22", also a temporal marker)

Acceptance: `git grep -n BACKLOG -- services` returns nothing; each repointed id resolves under tracker/.
<!-- SECTION:DESCRIPTION:END -->
