---
id: TASK-1239
title: Delete-obsolete-beta.209-smoke-checklist-docs-local-owner-yes-pending
status: To Do
assignee: []
created_date: '2026-10-16 21:10'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 1227000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deck fleet audit 2026-10-16 asked for a disposition of docs/local/beta.209-smoke-checklist.md (untracked, gitignored, dated 2026-08-27). Verified OBSOLETE, not just stale by date: beta.209 shipped 2026-08-28; the checklist gate items ran (tracker task-787 cites the owner verdict from the beta.209 smoke run 2026-08-28, TASK-764 acceptance pass); any still-open beta.209 clauses live in their own tracker tasks (TASK-598/764/612 lines in CURRENT.md beta.209 section), which own that state — the file adds nothing and would send a reader running dev tests for a release seven weeks shipped. Disposition: delete, reason recorded here per the audit ask. The session-side rm was classifier-blocked because the delete request arrived via a cross-session peer and owner CLAUDE.md requires her explicit yes for any rm — correct call, so the deletion waits on her word (Needs Lila bullet added 2026-10-16). If she says keep instead: rename under a dated archive name and mark this task ruled out.

Owner question: delete docs/local/beta.209-smoke-checklist.md (obsolete beta.209 smoke list, verified stale) or keep it as a record under a dated archive name?
Recommendation: delete — the gate items ran and are recorded on their tracker tasks; keeping it can only send a reader running tests for a release seven weeks shipped.
<!-- SECTION:DESCRIPTION:END -->
