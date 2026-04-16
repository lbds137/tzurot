---
name: tzurot-docs
description: 'Session workflow procedures. Invoke with /tzurot-docs for session start/end, CURRENT.md/BACKLOG.md management.'
lastUpdated: '2026-02-07'
---

# Documentation & Session Workflow

**Invoke with /tzurot-docs** for session management and documentation procedures.

## Session Start Procedure

1. Read `CURRENT.md` - What's the active task?
2. Read `BACKLOG.md` High Priority - What's next?
3. Continue active task or pull next

## Session End Procedure

1. Update `CURRENT.md` with progress
2. If task incomplete, note blockers in Scratchpad
3. **Run both BACKLOG gates** (see `.claude/rules/06-backlog.md`):
   - **Additions gate**: every promised backlog item from this session's
     plans is actually written to `BACKLOG.md`
   - **Removals gate**: every item that shipped in this session's merged
     PRs is removed from `BACKLOG.md`. Grep the backlog against the
     session's PR titles and scope terms; delete matches. This gate is
     the one that most often gets skipped, producing backlog rot.
4. Commit with `wip:` prefix if session ended with incomplete work

## Work Tracking Files

| File         | Purpose                               | Update When                   |
| ------------ | ------------------------------------- | ----------------------------- |
| `CURRENT.md` | Active session - what's happening NOW | Start/end session, task done  |
| `BACKLOG.md` | Everything else - all queued work     | New ideas, triage, completion |

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

## BACKLOG.md Structure

```markdown
## Inbox

_New items. Triage to appropriate section later._

## High Priority

_Top 3-5 items to pull into CURRENT next._

## Epic: [Theme Name]

_Group related work by project._

## Smaller Items

_Opportunistic work._

## Icebox

_Ideas for later._
```

## Workflow Operations

### Intake (New Idea)

Add to **Inbox** in BACKLOG.md with a tag:

```markdown
- ✨ `[FEAT]` **Feature Name** - Brief description
```

### Start Work (Pull)

1. Cut task from BACKLOG.md
2. Paste into CURRENT.md under **Active Task**
3. Add checklist if needed
4. Update **Session Goal**

### Complete Work (Done)

1. Mark task complete in CURRENT.md
2. Move to **Recent Highlights** (keep last 3-5)
3. Pull next task from BACKLOG High Priority

## Documentation Standards

For doc placement, naming, and lifecycle rules, see `.claude/rules/07-documentation.md`.

## References

- Current session: `CURRENT.md`
- All work items: `BACKLOG.md`
- Documentation standards: `.claude/rules/07-documentation.md`
- Documentation audit: `.claude/skills/tzurot-doc-audit/SKILL.md`
