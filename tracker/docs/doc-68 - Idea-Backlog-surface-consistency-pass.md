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

## Owner ruling 2026-10-12: restructure in Tzurot first, then extract to Seyag

Context: the 2026-10-12 backlog review (map + reader reports in `docs/local/backlog-review-2026-10-12/`, local) found the tracker itself sound and the hand-maintained status surfaces divergent: `active-epic.md` names doc-14 as active while `now.md` omits it; 80 `state:observable` watches sit in every work list; 82 of 110 docs have no open task and no status field; owner-question labels outlive their rulings. One root cause: status lives in prose, not checkable fields.

Owner picked (AskUserQuestion, 2026-10-12): **fix the model here first, then extract a configurable engine to Seyag.** Scope widens this doc from a sweep to a restructure:

1. **Watching status**: add `Watching` to `backlog.config.yml` statuses; move `state:observable` tasks to it so default lists show only startable work.
2. **Doc status frontmatter**: every tracker doc gets `status: idea | active | parked | done`, `gated_by:` (doc/task ids or `owner`), `last_reviewed:`.
3. **Generated active view**: `now.md`'s current-focus section generated from doc status; retire `backlog/active-epic.md` and `backlog/cold/queue.md` into doc statuses. CURRENT.md points at it instead of restating (member 1 above).
4. **Contradiction lint**: `pnpm ops backlog` flags an active doc with no commit referencing it in 30 days, a `state:owner` task carrying a ruling comment, a `dependent` task whose blocker is Done.
5. Members 1-4 above and TASK-1090, TASK-637 fold in.

Then **Seyag extraction** (request via the Deck session; Seyag is public, so generic only): a configurable `backlog-steward` (lint, digest, owner queue, freshness sweep) driven by per-project config, a skill carrying the filing/disposition protocol, and the Backlog Map regenerated from data. Tzurot keeps its data plus a config file. Extract only after steps 1-4 land, so the clean model is what ports.