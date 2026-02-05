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
