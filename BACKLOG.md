# Backlog

> **Last Updated**: 2026-07-28 (substrate migration complete: small items are `tracker/tasks/`, themes/ideas are `tracker/docs/`)

This is the **load manifest** for the backlog. Three surfaces:

- **HOT** (`backlog/` curated files + the generated digest) — read at session start.
- **`tracker/`** (Backlog.md store) — tasks (small items) + docs (themes/ideas); **query on demand, never load wholesale**.
- **COLD** (`backlog/cold/`) — the theme queue + epic log; grep-on-demand.

Keeping the pool and the cold files out of the session-start load is the whole point — session-start context is _now_, not the full archive of future work.

---

## Session-start load (HOT)

| Surface                                            | What                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `BACKLOG.md` (this file)                           | Load manifest + filing decision-tree                                                   |
| [`backlog/now.md`](backlog/now.md)                 | 🚨 Production Issues · 🎯 Current Focus (≤3) · ⚡ Quick Wins (≤5) · 📥 Untriaged (≤10) |
| [`backlog/active-epic.md`](backlog/active-epic.md) | Current epic roadmap + current phase                                                   |
| [`backlog/references.md`](backlog/references.md)   | Cross-links to research docs / post-mortems                                            |
| `pnpm ops backlog:digest`                          | Generated tracker briefing: per-area counts · oldest 20 · newest 10 (~60 lines)        |

## The tracker store (query on demand)

The small-item pool: one task file per follow-up under `tracker/tasks/`, managed by the Backlog.md CLI (`pnpm tracker`). Never read the directory wholesale — query it:

```bash
pnpm tracker task list --search <term> --plain    # by text
pnpm tracker task list -l area:<x> --plain        # by area label
pnpm tracker task list -l size:S --plain          # by size (S / M / L)
pnpm tracker task list --priority high --plain    # by priority (high / medium / low)
pnpm tracker task view <id> --plain               # one task, full detail
pnpm tracker task create 'Title' -d $'Why: ...' -l area:<x>   # file a new item
pnpm tracker task edit <id> -s Done               # finish at ship
```

Every task carries `area:*` + `size:*` labels and a priority (labeled in the step-3 pass): `size:S` <~1hr one-file · `size:M` a PR · `size:L` multi-PR/needs-design; priority `high` prod-correctness/data-rights · `medium` real improvement · `low` gated/speculative/watch. The drain query is `pnpm tracker task list -l size:S --priority high --plain`.

Full conventions (labels, finishing, integrity gating): [`.claude/rules/06-backlog.md`](.claude/rules/06-backlog.md) § The tracker store.

## Grep-on-demand (COLD — never auto-loaded)

| File                                                   | What                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| [`backlog/cold/queue.md`](backlog/cold/queue.md)       | Ordered index of future themes → references tracker docs (`doc-N`) |
| [`backlog/cold/epic-log.md`](backlog/cold/epic-log.md) | Detailed per-PR log for the Active Epic                            |

Theme and idea content lives in the tracker doc store (`tracker/docs/` — `Theme:`/`Idea:`-titled docs, shared search index with tasks): `pnpm tracker doc search <query>` · `pnpm tracker doc view <id>` · `pnpm tracker doc create 'Idea: Title'`.

---

## Where does a new item go? (filing decision-tree)

**First, the admission bar.** If the work belongs to **this same file or diff** ("next time we touch this"), **do it now** in the work that surfaced it — it's colocated and small by construction. If it's a **named batch across files** ("next tooling-DRY pass"), file the _batch_ as a theme-doc phase or an idea doc and make this item one of its members — search the tracker (`task list --search` + `doc search`) first so you join an existing entry instead of fragmenting. Everything else small gets filed as a task, **no trigger required** — trigger-gating is retired as a filing rule; `Promote when:` is optional annotation. Full rule: [`.claude/rules/06-backlog.md`](.claude/rules/06-backlog.md) § The admission bar.

Then file by **size/granularity**:

1. **Active production bug?** → `now.md` › 🚨 Production Issues (fix before features)
2. **Working on it this week?** → `now.md` › 🎯 Current Focus (max 3)
3. **Small (<~2hr), independent, and you'll actually do it soon?** → `now.md` › ⚡ Quick Wins (max 5) — it's simply next in line
4. **Small, one sentence — everything else?** → `tracker/` task (`pnpm tracker task create`)
5. **Part of the active epic?** → update `active-epic.md` (slice detail → `cold/epic-log.md`)
6. **A single feature that needs scoping (a paragraph)?** → tracker idea doc (`pnpm tracker doc create 'Idea: …'`)
7. **A multi-phase initiative (its own epic)?** → tracker theme doc (`'Theme: …'`) + a bullet in `cold/queue.md`
8. **Just arrived mid-session, no time to triage?** → `now.md` › 📥 Untriaged (max 10); route it later

**The granularity ladder:** one-sentence item → tracker task; paragraph idea → idea doc; multi-phase epic → theme doc + queue bullet.

## Staleness — aging escalates, it never deletes

Items are **never** deleted by calendar. The digest's oldest-20 surface exists so aged items get a conscious decision — not a sweep under the rug. An item leaves the backlog on exactly **three** exits: **done** (mark Done / remove; git and `tracker/archive` are the archive), **genuinely obsolete** (the code/condition it references no longer exists — verify by grep, not by date), or **ruled out** (a deliberate decision not to do it, with a technical reason in the removing commit — never "it's old"). Full guards on the third: [`.claude/rules/06-backlog.md`](.claude/rules/06-backlog.md) § Ruling an item out.

## Conventions

- **Tags** (backlog markdown files): 🏗️ `[LIFT]` refactor/debt · ✨ `[FEAT]` feature · 🐛 `[FIX]` bug · 🧹 `[CHORE]` maintenance. Tracker tasks use `area:*` labels instead.
- **Direct doc-commits to `develop`**: `backlog/**/*.md` and `tracker/**/*.md` are in the doc-commit-allowed list (per `.claude/rules/00-critical.md`) — routine triage needs no PR.
- **Triage rules, caps, and the staleness principle**: `.claude/rules/06-backlog.md`.
- **Lint**: `pnpm ops backlog` gates the caps, `cold/queue.md` doc-reference integrity, and tracker task-file parse integrity (in `pnpm quality` + CI).
