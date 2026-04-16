# Backlog Management

## Structure

The backlog follows a "Now, Next, Later" topology with clear focus:

| Section              | Purpose                                    | Max Items |
| -------------------- | ------------------------------------------ | --------- |
| 🚨 Production Issues | Active bugs in production. Fix first.      | No limit  |
| 📥 Inbox             | New items. Triage weekly.                  | No limit  |
| 🎯 Current Focus     | This week's active work.                   | 3         |
| ⚡️ Quick Wins        | Small tasks for momentum between features. | ~5        |
| 🏗 Active Epic       | Current major initiative with phases.      | 1         |
| 📅 Next Epic         | Ready to start when current epic ends.     | 1         |
| 📦 Future Themes     | Epics ordered by dependency.               | Unlimited |
| 🧊 Icebox            | Ideas for later. Resist the shiny object.  | Unlimited |
| ⏸️ Deferred          | Decided not to do yet, with reasoning.     | Unlimited |

## Session Workflow

### Starting a Session

1. Read `CURRENT.md` for context
2. Check 🚨 Production Issues - fix before new features
3. Check 🎯 Current Focus - continue active work
4. If Current Focus is empty, pull from Quick Wins or Active Epic

### Ending a Session

1. Update `CURRENT.md` with session progress
2. Move completed items from Current Focus
3. Add any new items to Inbox
4. Triage Inbox if items are piling up

## Out-of-Scope Items Must Be Tracked

Marking something "out of scope" is NOT permission to ignore it. Any known defect, inconsistency, or technical deficiency you decide not to fix in the current work **must** land in `BACKLOG.md` with a concrete destination section. Applies to plans, PRs, code reviews, and ad-hoc work.

### Two types of "out of scope" — only one needs tracking

| Type                    | What it is                                                                                                                     | Example                                                                                             | Track?                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **(a) Design decision** | Current code is fine; you're choosing not to extract/refactor because doing so would be over-abstraction                       | "Not extracting this helper — trades 5 lines of linear code for 8 lines of options-object ceremony" | **No** — it's a judgment call, not a defect       |
| **(b) Known defect**    | Something is wrong (bug, naming drift, stale entry, duplicated code) but fixing it would bloat the PR or needs separate design | "File is `settings.ts` but command is `/channel context`; four-layer naming drift"                  | **Yes** — concrete entry with destination section |

When uncertain between (a) and (b), **err toward tracking**.

### Plan-level requirement

Plan files produced in plan mode must include a "Backlog Additions Required" section enumerating every type-(b) out-of-scope item with:

1. **Destination section** (🚨 Production Issues / 📥 Inbox / ⚡️ Quick Wins / 🧊 Icebox / ⏸️ Deferred)
2. **Problem**: one paragraph describing what's wrong
3. **Action**: concrete, specific steps to fix
4. **Why out of scope**: one sentence on why it isn't being fixed now

### Session-end gate (additions)

A session is NOT done until every promised backlog addition is actually written to `BACKLOG.md`. Before running session-end cleanup:

- Re-read the plan's "Backlog Additions Required" section
- Verify each item exists in `BACKLOG.md` in the promised destination section
- If any are missing, write them first — then close the session

### Session-end gate (removals)

A session is ALSO not done until every item that shipped during the session is removed from `BACKLOG.md`. Additions without removals is what lets the backlog rot. Specifically:

- List the PRs merged during the session
- For each PR, grep `BACKLOG.md` for the item title/topic — if a matching entry exists, **remove it**
- For any backlog entry annotated "PROMOTED to Current Focus" or similar, re-verify the underlying fix actually shipped; if yes, remove
- Also remove any entry whose "Start" hints point to code that no longer needs fixing (grep the file to confirm)

Both gates pair with the session-end workflow in the `/tzurot-docs` skill. Additions protect the "out of scope" commitment; removals protect against backlog bloat from items the repo no longer needs.

## Triage Rules

### Inbox → Other Sections

| If the item is...             | Move to...           |
| ----------------------------- | -------------------- |
| Active production bug         | 🚨 Production Issues |
| Needed this week              | 🎯 Current Focus     |
| Small (<1 hour), independent  | ⚡️ Quick Wins        |
| Part of current epic          | 🏗 Active Epic       |
| Part of a future theme        | 📦 Future Themes     |
| Nice-to-have, no urgency      | 🧊 Icebox            |
| Decided against (with reason) | ⏸️ Deferred          |

### Promoting Epics

When Active Epic completes:

1. Move Active Epic to Future Themes (as completed reference) or delete if no longer relevant
2. Promote Next Epic to Active Epic
3. Choose new Next Epic from Future Themes (pick based on dependencies + value)

## Epic Structure

Each epic should have:

```markdown
## 🏗 Active Epic: Name

_Focus: One-sentence goal._

### Phase 1: Quick Wins (IN CURRENT FOCUS)

- [ ] Concrete task 1
- [ ] Concrete task 2

### Phase 2: Core Work

- [ ] Task with dependencies noted

### Phase 3: Polish (Optional)

- [ ] Nice-to-haves if time permits
```

## Anti-Patterns

| Don't                              | Do Instead                              |
| ---------------------------------- | --------------------------------------- |
| Have 10 items in Current Focus     | Max 3 items. Focus beats breadth.       |
| Leave items in Inbox for months    | Triage weekly. Icebox or delete.        |
| Work on Icebox items spontaneously | Promote to Quick Wins first.            |
| Have multiple "Active Epics"       | One epic. Queue the rest as Next.       |
| Add items without context          | Include why, what, and acceptance.      |
| Delete items you might revisit     | Move to Icebox or Deferred with reason. |

## Tags

Use consistently across all sections:

- 🏗️ `[LIFT]` - Refactor/tech debt
- ✨ `[FEAT]` - New feature
- 🐛 `[FIX]` - Bug fix
- 🧹 `[CHORE]` - Maintenance/cleanup
