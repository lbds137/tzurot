---
id: doc-68
title: 'Idea: Backlog-surface consistency pass'
type: other
created_date: '2026-08-09 17:57'
---

_Origin: owner musing 2026-08-09 ("maybe there are still warts / inconsistencies in our backlog management approach") after confusing `now.md` with `CURRENT.md` at session start._

One audit pass over the backlog surfaces (`06-backlog.md`, `BACKLOG.md`, `now.md`, `CURRENT.md`, tracker conventions) for accumulated warts. Known members at filing:

1. **Hot-surface overlap**: CURRENT.md's resume-sequence block and `now.md` › Current Focus both claim "what's next" — different cadences (per-session vs per-ship), and the owner couldn't recall the split. Candidate fix: CURRENT.md points at the board instead of restating it, or the split gets a one-line banner on each file.
2. **Watch items in 🚨 Production Issues**: entries whose fix already shipped and are only awaiting prod-event verification (the 2026-07-12 lock-timeout and 2026-07-14 multi-tag-wedge entries) sit in a section defined as "active bugs, fix before new features." They are `state:observable` by the tracker's own axis — candidate fix: move release-verified-pending items to tracker tasks with `state:observable`, or add a Watch subsection.
3. **Entry size**: `now.md` entries run to multi-hundred-word paragraphs on a surface whose stated goal is "keep it small"; no per-entry budget exists (the lines gate caps CURRENT.md but not now.md).
4. **Already-filed relatives**: TASK-486 (documented drain query includes Done tasks), TASK-492 (backlog gate: duplicate task ids). Fold into the pass if still open.

Scope: one PR's worth of sweeping (06-backlog edits + entry moves) → idea-doc tier per the granularity ladder. Not scheduled; no trigger needed.