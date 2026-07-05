---
name: tzurot-docs
description: 'Session workflow procedures. Invoke with /tzurot-docs for session start/end, CURRENT.md and backlog management.'
lastUpdated: '2026-07-05'
---

# Documentation & Session Workflow

**Invoke with /tzurot-docs** for session management and documentation procedures.

## Session Start Procedure

The backlog is HOT/COLD split — load only the HOT surface at start (see `BACKLOG.md`, the manifest):

1. Read `CURRENT.md` - What's the active task?
2. Read `backlog/now.md` - 🚨 Production Issues (fix first) → 🎯 Current Focus (continue) → ⚡ Quick Wins
3. Read `backlog/active-epic.md` - the current major initiative + its current phase
4. Do NOT load `backlog/cold/` — grep it only when a task points you there

## Session End Procedure

1. Update `CURRENT.md` with progress
2. **Enforce the CURRENT.md cap**: current-state sections + the last **2** session retrospectives only — delete older "Last Session" sections (git preserves them). CURRENT.md is the first file read every session; it once grew to 662 lines (5× the whole hot backlog) before this cap existed.
3. If task incomplete, note blockers in Scratchpad
4. **Run both BACKLOG gates** (see `.claude/rules/06-backlog.md`):
   - **Additions gate**: every promised backlog item from this session's plans is actually written to the appropriate `backlog/**/*.md` file
   - **Removals gate**: every item that shipped in this session's merged PRs is removed from its backlog file. `grep -r backlog/` (recursive — includes `cold/`) against the session's PR titles and scope terms; delete matches. This gate most often gets skipped, producing backlog rot. (Removal is for _shipped_ or _genuinely obsolete_ items only — never time-based pruning; aging escalates, it doesn't delete.)
5. Commit with `wip:` prefix if session ended with incomplete work

## Work Tracking Files

| File                     | Purpose                                           | Update When                    |
| ------------------------ | ------------------------------------------------- | ------------------------------ |
| `CURRENT.md`             | Active session — what's happening NOW             | Start/end session, task done   |
| `BACKLOG.md`             | Load manifest + filing decision-tree              | When the structure changes     |
| `backlog/now.md`         | HOT: prod issues / focus / quick-wins / untriaged | New ideas, triage, completion  |
| `backlog/active-epic.md` | HOT: current epic roadmap + phase                 | Phase progress                 |
| `backlog/cold/*`         | COLD: themes / ideas / follow-ups / epic-log      | Grep-on-demand; route + update |

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

HOT (loaded every session) / COLD (grep-on-demand). See `.claude/rules/06-backlog.md` for the canonical topology + the **granularity-ladder** filing rule (multi-phase epic → `cold/themes/`; paragraph idea → `cold/ideas.md`; one-sentence follow-up → `cold/follow-ups.md`) and the **staleness principle** (aging escalates priority; items are never deleted by calendar — only when done or genuinely obsolete). `BACKLOG.md` at root is the load manifest.

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

1. **Hunt**: sweep `backlog/now.md` (Quick Wins, Untriaged) + `backlog/cold/follow-ups.md`
   (oldest first — `pnpm ops backlog` surfaces them) for small-to-medium items
   that are build-ready (no pending decision, no design dependency).
2. **Batch**: group compatible items into FEW consolidated PRs (per-item PR
   ceremony is the anti-pattern; one themed PR with separate logical commits).
3. **Consolidate/prune while there**: items superseded by shipped work get
   removed (verify by grep, not by date); umbrella entries get sub-items struck.
4. **Measure net shrink**: the success metric is the backlog getting SMALLER —
   report entries removed vs. added at the end of the sweep.
