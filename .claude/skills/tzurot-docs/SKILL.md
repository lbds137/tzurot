---
name: tzurot-docs
description: 'Session workflow procedures. Invoke with /tzurot-docs for session start/end, CURRENT.md and backlog management.'
lastUpdated: '2026-09-25'
---

# Documentation & Session Workflow

**Invoke with /tzurot-docs** for session management and documentation procedures.

## Session Start Procedure

**Canonical, single-sourced in `.claude/rules/06-backlog.md` § Starting a Session** — follow it there, not a copy here. It is always-loaded, so every session already has it.

This section previously carried its own shorter copy, which fell three steps behind the canonical list (`backlog:digest`, the freshness-check, and the repo-state sweep). Two checklists describing the same moment will keep diverging; the pointer is the fix.

## Session End Procedure

1. Update `CURRENT.md` with progress
2. **Enforce the CURRENT.md cap**: current-state sections + the last **2** session retrospectives only — delete older "Last Session" sections (git preserves them). CURRENT.md is the first file read every session; it once grew to 662 lines (5× the whole hot backlog) before this cap existed.
3. If task incomplete, note blockers in Scratchpad
4. **Board bookkeeping**: mark shipped tracker tasks Done; remove shipped items from `backlog/now.md` (and any `cold/` file that tracked them). Capture new items per the filing decision-tree (`BACKLOG.md`); `now.md` › 📥 Untriaged only for mid-session parking. Keep the caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10.
5. **Run both BACKLOG gates**:
   - **Additions gate**: a session is NOT done until every promised backlog addition is written to its promised destination — re-read the plan's "Backlog Additions Required" section and verify each item exists (`pnpm tracker task list --search <term> --plain` for tasks; the file for markdown entries). Write any missing ones first.
   - **Removals gate**: a session is ALSO not done until every item that shipped during the session is closed out. List the PRs merged during the session; for each, search the tracker (`--search` by title/topic), `pnpm tracker doc search`, AND grep `backlog/` (recursive — includes `cold/`) against the session's PR titles and scope terms — mark any matching entry Done / **remove it** (this gate most often gets skipped, producing backlog rot; removal is for _shipped_ or _genuinely obsolete_ items only — never time-based pruning). **When a merged PR completes a PHASE (or the last slice) of a theme doc, grep the doc id — `grep -rn 'doc-N' backlog/ tracker/docs/` — and rewrite every hit's status words** (a PR-title grep never matches a roadmap line that names the epic by id, so a shipped phase stays marked queued until someone re-reads the board against git). For any entry annotated "PROMOTED to Current Focus" or similar, re-verify the fix actually shipped; if yes, remove. Remove any entry whose fix-shape points to code that no longer needs fixing (grep the file to confirm) — the "genuinely obsolete" path, not time-based pruning. **Did every rule-out decided this session actually get committed?** Name each item ruled out this session and confirm its commit exists — a decision that stayed in chat removed nothing.
   - **Strike through sub-items at absorption, not at PR close.** When a PR resolves ONE sub-item of an umbrella entry (multi-item audit, grouped follow-ups), strike it through in the same working session.
6. **Structural sweep**: name any failure that occurred twice-or-more this session and its disposition — rule / skill / hook / explicitly none-needed with the reason. "Nothing recurred" must be stated, not implied. The gap this closes is self-_initiation_: once the owner asks "do we need a rule/hook?" the response is reliably fast, so the miss is noticing at the moment of the second occurrence, not building. (`/tzurot-session-mining` is the periodic backstop; this is the per-session one.)
7. Commit with `wip:` prefix if session ended with incomplete work

## Work Tracking Files

| File                     | Purpose                                           | Update When                             |
| ------------------------ | ------------------------------------------------- | --------------------------------------- |
| `CURRENT.md`             | Active session — what's happening NOW             | Start/end session, task done            |
| `BACKLOG.md`             | Load manifest + filing decision-tree              | When the structure changes              |
| `backlog/now.md`         | HOT: prod issues / focus / quick-wins / untriaged | New ideas, triage, completion           |
| `backlog/active-epic.md` | HOT: current epic roadmap + phase                 | Phase progress                          |
| `backlog/cold/*`         | COLD: theme queue + epic log                      | Grep-on-demand; route + update          |
| `tracker/tasks/*`        | Small-item pool (Backlog.md store)                | Query via `pnpm tracker`; file + finish |
| `tracker/docs/*`         | Theme/idea docs (shared search index)             | `pnpm tracker doc search/view/create`   |

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

## CURRENT.md Structure

```markdown
# Current

> **Session**: YYYY-MM-DD
> **Version**: v3.0.0-beta.XX

## Session Goal

_One sentence on what we're doing today._

## Active Task

🏗️ `[LIFT]` **Task Name**

- [ ] Subtask 1
- [ ] Subtask 2

## Scratchpad

_Error logs, decisions, API snippets._

## Recent Highlights

- **beta.XX**: Brief description
```

## Backlog Structure

HOT (loaded every session) / tracker store (queried) / COLD (grep-on-demand). See `BACKLOG.md` (root, the load manifest) for the canonical topology, the filing decision-tree, and the **granularity-ladder** filing rule (multi-phase epic → tracker theme doc + `cold/queue.md` bullet; paragraph idea → tracker idea doc via `pnpm tracker doc create`; one-sentence follow-up → tracker task via `pnpm tracker task create`). The **staleness principle** (aging escalates priority; items are never deleted by calendar — only when done or genuinely obsolete) is `.claude/rules/06-backlog.md` § Staleness.

## Promoting a theme to Active Epic

When the Active Epic completes:

0. **Re-touch the system map**: walk [`docs/reference/architecture/system-model.md`](../../../docs/reference/architecture/system-model.md) asking "what did this epic change?" and apply the edits — or record "no map impact" in the epic close-out. (Mid-epic, file a drift note when a PR changes something the map describes — never auto-append; its ~150-line budget forces eviction, not growth.)
1. Remove the finished epic from `active-epic.md`, folding any still-relevant follow-on into `cold/` or tracker tasks. **If the outgoing epic is NOT finished — a pivot or a park — it gets a row in `cold/queue.md` § Half-finished** (remainder, bin: gated / owner / pivoted, and the trigger); a `pivoted` row with no trigger is the signal to convert the remainder into drain tasks rather than carry an epic that reads as in-progress — a remainder with no row is neither done nor honestly parked.
2. Pick the next theme from `cold/queue.md` by dependency + value — a substantial pick gets a council pass before plan-mode.
3. Move that theme doc's content (`pnpm tracker doc view <id>`) into `active-epic.md` (slim roadmap in the hot file; dense per-PR detail to `cold/epic-log.md`) and remove its `cold/queue.md` bullet.

## Theme/Epic Structure

A theme doc (`tracker/docs/`, `Theme:`-titled) or the active epic is headed `### Theme: Name`, carries a `_Focus: one-sentence goal._` line, then `### Phase N — ...` headings (marked ✅ DONE / NEXT) holding checkbox tasks with their dependencies noted.

## Workflow Operations

### Intake (New Idea)

Capture in **`backlog/now.md` › 📥 Untriaged** mid-session, then route per the granularity ladder (or file directly if the home is obvious):

```markdown
- ✨ `[FEAT]` **Feature Name** - Brief description
```

### Start Work (Pull)

1. Take the task from `backlog/now.md` (Current Focus or Quick Wins), or promote a theme from `cold/queue.md`
2. Paste into CURRENT.md under **Active Task**
3. Add checklist if needed
4. Update **Session Goal**

### Complete Work (Done)

1. Mark task complete in CURRENT.md
2. Move to **Recent Highlights** (keep last 3-5)
3. Remove the shipped item from `backlog/now.md` (removals gate)
4. Pull next task from `now.md` Current Focus / Quick Wins

## Documentation Standards

For doc placement, naming, and lifecycle rules, see `.claude/rules/07-documentation.md`.

## References

- Current session: `CURRENT.md`
- All work items: `BACKLOG.md` (manifest) → `backlog/now.md` + `backlog/active-epic.md` (HOT) → `backlog/cold/*` (COLD)
- Documentation standards: `.claude/rules/07-documentation.md`
- Documentation audit: `.claude/skills/tzurot-doc-audit/SKILL.md`

## Backlog Quick-Wins / Net-Shrink Sweep

A recurring owner ritual (session warm-up and pre-release); run it as a
procedure, don't wait to be walked through it:

1. **Hunt**: sweep `backlog/now.md` (Quick Wins, Untriaged) + the tracker pool
   (oldest first — `pnpm ops backlog:digest` surfaces them; drill in with
   `pnpm tracker task list --search/-l`) for small-to-medium items that are
   build-ready (no pending decision, no design dependency).
2. **Batch**: group compatible items into FEW consolidated PRs (per-item PR
   ceremony is the anti-pattern; one themed PR with separate logical commits).
3. **Consolidate/prune while there**: items superseded by shipped work get
   removed (verify by grep, not by date); umbrella entries get sub-items struck.
4. **Measure net shrink**: the success metric is the backlog getting SMALLER —
   report entries removed vs. added at the end of the sweep.
5. **Standing drain directive = running net at every batch.** While a
   drain/shrink directive is in force, every batch report states the running
   session net (tasks closed vs tasks filed). Any task the assistant itself
   generates (process/meta work — audits, gates, skill/hook improvements) is
   named as such at filing time and counts visibly against the net — growth
   must be visible at the moment it happens, not discovered by the owner later.
