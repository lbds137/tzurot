# Backlog

> **Last Updated**: 2026-07-03
> **Version**: v3.0.0-beta.146 (released 2026-07-03); develop state: see `CURRENT.md`

This is the **load manifest** for the backlog. The backlog is split **HOT** (loaded every session) / **COLD** (grep-on-demand). Read the HOT files at session start; reach into COLD only when a task points you there. Keeping cold/ out of the session-start load is the whole point — it keeps the agent's context focused on _now_, not the full archive of future work.

---

## Session-start load (HOT — read these every session)

| File                                               | What                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `BACKLOG.md` (this file)                           | Load manifest + filing decision-tree                                                   |
| [`backlog/now.md`](backlog/now.md)                 | 🚨 Production Issues · 🎯 Current Focus (≤3) · ⚡ Quick Wins (≤5) · 📥 Untriaged (≤10) |
| [`backlog/active-epic.md`](backlog/active-epic.md) | Current epic roadmap + current phase                                                   |
| [`backlog/references.md`](backlog/references.md)   | Cross-links to research docs / post-mortems                                            |

That's the whole session-start surface (~350 lines). **Do NOT load `backlog/cold/` at session start** — grep it on demand.

## Grep-on-demand (COLD — never auto-loaded)

| File                                                       | What                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| [`backlog/cold/queue.md`](backlog/cold/queue.md)           | Ordered index of future themes → links into `cold/themes/`  |
| `backlog/cold/themes/<slug>.md`                            | One file per multi-phase epic (the big queue)               |
| [`backlog/cold/ideas.md`](backlog/cold/ideas.md)           | Ungated speculative features + larger fixes (prose)         |
| [`backlog/cold/follow-ups.md`](backlog/cold/follow-ups.md) | Terse review-nit / "do X when Y happens" follow-ups (table) |
| [`backlog/cold/epic-log.md`](backlog/cold/epic-log.md)     | Detailed per-PR log for the Active Epic                     |

---

## Where does a new item go? (filing decision-tree)

File by **size/granularity** — NOT by whether it has a trigger. ("Promote when…" is an optional field on any item, never a filing rule. This is the lesson from the old Deferred-vs-Icebox collapse.)

1. **Active production bug?** → `now.md` › 🚨 Production Issues (fix before features)
2. **Working on it this week?** → `now.md` › 🎯 Current Focus (max 3)
3. **Small (<~2hr), independent, one sentence?** → `now.md` › ⚡ Quick Wins (max 5) if you'll do it soon; else `cold/follow-ups.md` (table row)
4. **Part of the active epic?** → update `active-epic.md` (slice detail → `cold/epic-log.md`)
5. **A single feature that needs scoping (a paragraph)?** → `cold/ideas.md` (`##` section)
6. **A multi-phase initiative (its own epic)?** → new `cold/themes/<slug>.md` + a bullet in `cold/queue.md`
7. **Just arrived mid-session, no time to triage?** → `now.md` › 📥 Untriaged (max 10); route it later

**The granularity ladder:** one-sentence follow-up → `follow-ups.md`; paragraph idea → `ideas.md`; multi-phase epic → `themes/`.

## Staleness — aging escalates, it never deletes

Items are **never** deleted by calendar. An untouched follow-up that's aged RISES in priority and gets surfaced for a conscious decision (do it now / confirm the trigger is still pending) — it is not swept under the rug. An item leaves the backlog only when it is **done** or **genuinely obsolete** (the code/condition it references no longer exists — verify by grep, not by date). Completed items are removed; git is the archive.

## Conventions

- **Tags**: 🏗️ `[LIFT]` refactor/debt · ✨ `[FEAT]` feature · 🐛 `[FIX]` bug · 🧹 `[CHORE]` maintenance
- **Direct doc-commits to `develop`**: `backlog/**/*.md` are in the doc-commit-allowed list (per `.claude/rules/00-critical.md`) — routine triage needs no PR.
- **Triage rules, caps, and the staleness principle**: `.claude/rules/06-backlog.md`.
- **Lint**: `pnpm ops backlog` checks the caps, surfaces the oldest follow-ups (escalation nudge, not a delete flag), and flags dangling `cold/themes/` links.
