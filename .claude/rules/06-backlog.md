# Backlog Management

## Structure

The backlog is split **HOT** (loaded every session) / **COLD** (grep-on-demand). `BACKLOG.md` at the repo root is the load manifest. The hot surface stays small so the agent's session-start context is _now_, not the full archive of future work.

### HOT — read at session start (the whole surface is ~350 lines)

| File                     | Contents                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `BACKLOG.md` (root)      | Load manifest + filing decision-tree                                                            |
| `backlog/now.md`         | 🚨 Production Issues · 🎯 Current Focus (max 3) · ⚡ Quick Wins (max 5) · 📥 Untriaged (max 10) |
| `backlog/active-epic.md` | The ONE current major initiative: roadmap + current phase                                       |
| `backlog/references.md`  | Cross-links to research docs / post-mortems                                                     |

### COLD — grep-on-demand, NEVER auto-loaded

| File                            | Contents                                                           |
| ------------------------------- | ------------------------------------------------------------------ |
| `backlog/cold/queue.md`         | Ordered index of future themes → links into `cold/themes/`         |
| `backlog/cold/themes/<slug>.md` | One file per multi-phase epic (the big queue)                      |
| `backlog/cold/ideas.md`         | Ungated speculative features + larger fixes (prose, `##` sections) |
| `backlog/cold/follow-ups.md`    | Terse review-nit / "do X when Y happens" follow-ups (table)        |
| `backlog/cold/epic-log.md`      | Detailed per-PR slice log for the Active Epic                      |

### The granularity ladder (replaces the old Deferred/Icebox split)

File a "not now" item by **size**, not by whether it has a trigger:

| Item shape                                  | Home                                                  |
| ------------------------------------------- | ----------------------------------------------------- |
| Multi-phase initiative (its own epic)       | `cold/themes/<slug>.md` + a bullet in `cold/queue.md` |
| Single feature, needs scoping (a paragraph) | `cold/ideas.md` (`##` section)                        |
| One sentence, ~<2hr, usually a review-nit   | `cold/follow-ups.md` (table row)                      |

**"Promote when…" / a trigger is an optional FIELD on any item, never a filing rule.** The old Deferred (trigger-gated) vs Icebox (no trigger) distinction collapsed because nearly every parked item acquires a trigger — the real, decidable axis is granularity. Don't reintroduce a trigger-based bucket.

## Staleness — aging escalates, it never deletes

Items are **never** deleted by calendar. An untouched follow-up that's aged RISES in priority and gets surfaced for a conscious decision (do it now / confirm the trigger is still pending) — it is **not** swept under the rug. An item leaves the backlog only when it is:

- **done** (shipped — remove it; git is the archive), or
- **genuinely obsolete** — the code path, file, or condition it references no longer exists. Verify by grep before removing, not by date.

There is no "prune items older than N days" rule. Staleness is a signal to act, not a signal to discard. (`pnpm ops backlog` surfaces the oldest follow-ups as an escalation nudge — that's a prompt to decide, never an auto-delete.)

## Session Workflow

### Starting a Session

1. Read `CURRENT.md` for context
2. Read `backlog/now.md` — 🚨 Production Issues fix first; then continue 🎯 Current Focus
3. **Freshness-check before presenting**: a board entry is a snapshot, not a fact. Before presenting a Production Issue as live, verify it against reality (git log for fixes that already landed, the user's own runtime experience, recent release notes). When two entries share a symptom, check whether they're one underlying seam — the z.ai "routing bug" and the footer mis-attribution were tracked separately but were one bug.
4. If Current Focus is empty, pull from ⚡ Quick Wins (in `now.md`) or `backlog/active-epic.md`
5. Do NOT load `backlog/cold/` — grep it only when a task points you there

### Ending a Session

1. Update `CURRENT.md` with session progress
2. Remove shipped items from `backlog/now.md` (and any `cold/` file that tracked them)
3. Capture new items in `backlog/now.md` › 📥 Untriaged, then route them per the filing decision-tree (see `BACKLOG.md`)
4. Keep the caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10

## Out-of-Scope Items Must Be Tracked

Marking something "out of scope" is NOT permission to ignore it. Any known defect, inconsistency, or technical deficiency you decide not to fix in the current work **must** land in the appropriate `backlog/**/*.md` file with a concrete destination. Applies to plans, PRs, code reviews, and ad-hoc work.

**Commit messages, PR bodies, plan notes, and code comments are NOT substitutes for backlog entries.** Mentioning "adminFetch sites are a distinct follow-up" in a commit message, or writing `// TODO: migrate this later` in a comment, does not count as tracking — nobody greps commit history or scattered comments looking for deferred work. If the follow-up matters enough to mention anywhere, it matters enough to be a concrete entry in the appropriate `backlog/**/*.md` file before the current work closes.

**The promise ledger — file at the moment of utterance.** Any in-flight "I'll do X later / after this PR / when the release is done" — in chat, a plan, or a PR description — must land in the task list or the appropriate backlog file THE MOMENT it is said, not at session end. A promise that exists only in chat prose does not exist: it dies at the next compaction, and the user ends up asking "you said you were going to do X" / "what's the plan for getting those done?" (both recurred repeatedly). The session-end gates below are the backstop, not the mechanism.

### Two types of "out of scope" — only one needs tracking

| Type                    | What it is                                                                                                                     | Example                                                                                             | Track?                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **(a) Design decision** | Current code is fine; you're choosing not to extract/refactor because doing so would be over-abstraction                       | "Not extracting this helper — trades 5 lines of linear code for 8 lines of options-object ceremony" | **No** — it's a judgment call, not a defect |
| **(b) Known defect**    | Something is wrong (bug, naming drift, stale entry, duplicated code) but fixing it would bloat the PR or needs separate design | "File is `settings.ts` but command is `/channel context`; four-layer naming drift"                  | **Yes** — concrete entry with destination   |

When uncertain between (a) and (b), **err toward tracking**.

### Plan-level requirement

Plan files produced in plan mode must include a "Backlog Additions Required" section enumerating every type-(b) out-of-scope item with:

1. **Destination** (`now.md` Production Issues / Quick Wins / Untriaged · `cold/follow-ups.md` · `cold/ideas.md` · `cold/themes/`)
2. **Problem**: one paragraph describing what's wrong
3. **Action**: concrete, specific steps to fix
4. **Why out of scope**: one sentence on why it isn't being fixed now

### Session-end gate (additions)

A session is NOT done until every promised backlog addition is actually written to the appropriate `backlog/**/*.md` file. Before running session-end cleanup:

- Re-read the plan's "Backlog Additions Required" section
- Verify each item exists in the promised destination file (e.g. `backlog/now.md`, `backlog/cold/follow-ups.md`)
- If any are missing, write them first — then close the session

### Session-end gate (removals)

A session is ALSO not done until every item that shipped during the session is removed from its backlog file. Additions without removals is what lets the backlog rot. Specifically:

- List the PRs merged during the session
- For each PR, grep `backlog/` (recursive — includes `cold/`) for the item title/topic — if a matching entry exists, **remove it**
- For any backlog entry annotated "PROMOTED to Current Focus" or similar, re-verify the underlying fix actually shipped; if yes, remove
- Also remove any entry whose "Start" hints point to code that no longer needs fixing (grep the file to confirm). This is the "genuinely obsolete" removal path — it's distinct from time-based pruning, which we do NOT do.

**Strike through sub-items at absorption, not at PR close.** Umbrella entries (multi-item audits, grouped follow-ups) don't track sub-item resolution automatically: when a PR resolves ONE sub-item of an umbrella entry, strike it through in the same working session as the resolving PR — waiting for "later" is how umbrella entries silently rot into half-done.

Both gates pair with the session-end workflow in the `/tzurot-docs` skill.

## Triage Rules — where does a new item go?

File by size/granularity (see the ladder above); trigger is a field, not a bucket.

| If the item is...                        | Goes to...                                                          |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Active production bug                    | `now.md` › 🚨 Production Issues                                     |
| Needed this week                         | `now.md` › 🎯 Current Focus (max 3)                                 |
| Small (<~2hr), independent, one sentence | `now.md` › ⚡ Quick Wins (max 5) if soon; else `cold/follow-ups.md` |
| Part of the active epic                  | `active-epic.md` (slice detail → `cold/epic-log.md`)                |
| A single feature needing scoping         | `cold/ideas.md` (`##` section)                                      |
| A multi-phase initiative                 | `cold/themes/<slug>.md` + bullet in `cold/queue.md`                 |
| Arrived mid-session, no time to triage   | `now.md` › 📥 Untriaged (max 10), route later                       |

### Promoting a theme to Active Epic

When the Active Epic completes:

1. Remove the finished epic from `active-epic.md` (git preserves it; fold any still-relevant follow-on into `cold/`). Its detailed log in `cold/epic-log.md` can be deleted or kept as historical reference.
2. Pick the next theme from `cold/queue.md` (by dependency + value — each substantial pick deserves a council pass before plan-mode).
3. Move that theme's `cold/themes/<slug>.md` content into `active-epic.md` (slim roadmap in the hot file; push dense per-PR detail to `cold/epic-log.md`). Remove its bullet from `cold/queue.md`.

## Theme/Epic Structure

A theme file (`cold/themes/<slug>.md`) or the active epic should carry a `_Focus: one-sentence goal._` line and phase structure:

```markdown
### Theme: Name

_Focus: One-sentence goal._

### Phase 1 — ... (✅ DONE / NEXT / ...)

- [ ] Concrete task with dependencies noted
```

## Anti-Patterns

| Don't                              | Do Instead                                                        |
| ---------------------------------- | ----------------------------------------------------------------- |
| Put >3 items in Current Focus      | Max 3. Focus beats breadth.                                       |
| Let Untriaged pile up              | Route items per the ladder before session-end; empty is the goal. |
| Reintroduce a trigger-based bucket | Trigger is a field; file by granularity.                          |
| Delete an item because it's old    | Aging escalates priority — act on it, don't discard.              |
| Have multiple "Active Epics"       | One epic. The rest live in `cold/queue.md`.                       |
| Add items without context          | Include why, what, and acceptance.                                |
| Load `cold/` at session start      | It's grep-on-demand; only the HOT files load every session.       |

## Tags

Use consistently across all files:

- 🏗️ `[LIFT]` — Refactor/tech debt
- ✨ `[FEAT]` — New feature
- 🐛 `[FIX]` — Bug fix
- 🧹 `[CHORE]` — Maintenance/cleanup
