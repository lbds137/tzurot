# Backlog

> **Last Updated**: 2026-04-26
> **Version**: v3.0.0-beta.106 (released — next unreleased bundle starts fresh on develop)

Single source of truth for all work. Tech debt competes for the same time as features.

This file is the index. Each section below is its own file under [`backlog/`](backlog/) — keeps individual surfaces under ~300 lines and lets `grep` over a section's items be a single-file scan rather than a 1200-line haystack. Sections are listed in priority/triage order; an item's section IS its priority.

**Tags**: 🏗️ `[LIFT]` refactor/debt | ✨ `[FEAT]` feature | 🐛 `[FIX]` bug | 🧹 `[CHORE]` maintenance

---

## Sections

| Section              | File                                                           | Purpose                                                       |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| 🚨 Production Issues | [`backlog/production-issues.md`](backlog/production-issues.md) | Active bugs observed in production. Fix before new features.  |
| 📥 Inbox             | [`backlog/inbox.md`](backlog/inbox.md)                         | New items. Triage to appropriate section weekly.              |
| 🎯 Current Focus     | [`backlog/current-focus.md`](backlog/current-focus.md)         | This week's active work. Max 3 items.                         |
| ⚡️ Quick Wins        | [`backlog/quick-wins.md`](backlog/quick-wins.md)               | Small tasks for momentum between major features.              |
| 🏗 Active Epic       | [`backlog/active-epic.md`](backlog/active-epic.md)             | Current major initiative with phases.                         |
| 📅 Next Theme        | [`backlog/next-theme.md`](backlog/next-theme.md)               | Queued-after-active-epic theme. Currently: drive CPD to zero. |
| 📦 Future Themes     | [`backlog/future-themes.md`](backlog/future-themes.md)         | Themes ordered by dependency. The big queue.                  |
| 🧊 Icebox            | [`backlog/icebox.md`](backlog/icebox.md)                       | Ideas for later. Resist the shiny object.                     |
| ⏸️ Deferred          | [`backlog/deferred.md`](backlog/deferred.md)                   | Decided not to do yet, with reasoning.                        |
| 📚 References        | [`backlog/references.md`](backlog/references.md)               | Cross-links to research docs and post-mortems.                |

---

## Working with the backlog

- **Adding an item**: append to the appropriate section file. Default to `backlog/inbox.md` if you're unsure — weekly triage moves it.
- **Triaging**: see `.claude/rules/06-backlog.md` for the section-promotion rules.
- **Out-of-scope items during a PR**: must land in the appropriate `backlog/*.md` file before the session closes. Commit messages and code comments are not substitutes (per `.claude/rules/06-backlog.md` § "Out-of-Scope Items Must Be Tracked").
- **Direct doc commits to `develop`**: per `.claude/rules/00-critical.md`, `backlog/*.md` files are in the doc-commit-allowed list (no PR ceremony for routine triage updates).
- **Restructure rationale**: previously a single 1200-line file. Split surfaced 2026-04-26 — see git history for the migration commit. The "Theme: BACKLOG.md Structure Redesign" entry (formerly in `future-themes.md`) is now closed by this restructure.
