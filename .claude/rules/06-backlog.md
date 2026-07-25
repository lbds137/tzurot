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

### The admission bar — a trigger that needs someone to _remember_ is not a trigger

Before filing anything, check what would have to happen for it to be picked up:

| The trigger is...                                                                                                     | Then...                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| An **observable** — a user report, a metric threshold, a provider change, a feature landing                           | **File it.** We'll see the event when it happens.                                                                                                  |
| **This same file or diff** — "next time we touch this"                                                                | **Do it now**, in the work that surfaced it. It's colocated and small by construction.                                                             |
| **A named batch across files** — "next tooling-DRY pass", "next `.claude/rules` PR" — or simply too big for this diff | **File the batch, not the row.** A theme phase or a `cold/ideas.md` section owns the pass; this item is one of its members (per the ladder above). |

**Which one, for a batch**: if the whole pass is one PR's worth of sweeping, it's a `cold/ideas.md` section. If it needs its own phased rollout (per-package, per-service, or gated on something landing first), it's a theme. The ladder's axis is unchanged — this is the same size question, asked about the pass rather than the item.

**Grep `cold/` for the batch before creating it** — by the pass's name AND by the module it sweeps. The same pass gets surfaced repeatedly from whichever file someone was reading at the time, so filing a fresh section per sighting rebuilds the fragmentation this bar exists to prevent, one rung up the ladder. If an entry already owns the pass, add the item as a member of it.

Two shapes of trigger look like conditions but aren't. "Next time someone touches this" resolves to _never_, because nobody greps a several-hundred-row table before unrelated work — so filing it converts a five-minute edit into permanent context weight. "Next tooling-DRY pass" fails differently: the pass is real work, but filing its symptoms as rows means **the pass itself never gets scheduled**, and each row sits waiting to be rediscovered by the sweep it was supposed to prompt. Track the pass; let the rows be its members.

This does not weaken "out-of-scope items must be tracked" below — it changes the destination for two classes of item: one becomes a diff that ships today, the other becomes a scoped batch someone can actually pick up.

## Staleness — aging escalates, it never deletes

Items are **never** deleted by calendar. An untouched follow-up that's aged RISES in priority and gets surfaced for a conscious decision (do it now / confirm the trigger is still pending) — it is **not** swept under the rug. An item leaves the backlog on exactly **three** exits, and no others:

- **done** (shipped — remove it; git is the archive);
- **genuinely obsolete** — the code path, file, or condition it references no longer exists. Verify by grep before removing, not by date; or
- **ruled out** — a deliberate decision that we are not going to do this. Rationale goes in the removing commit, never a tombstone entry (`00-critical.md` § Always Leave Code Better Than You Found It).

There is no "prune items older than N days" rule. Staleness is a signal to act, not a signal to discard. (`pnpm ops backlog` surfaces the oldest follow-ups as an escalation nudge — that's a prompt to decide, never an auto-delete.)

### Ruling an item out

`10-working-posture.md` names four honest states for anything not-done — shipped, obsolete, **ruled out**, deferred — but only the first two were removal exits, so a real-but-not-worth-doing item had nowhere to go and stayed forever. This is that exit, and it is deliberately narrow:

- **A technical reason is required, stated in the removing commit.** "It's old," "nobody got to it," "pre-existing," and "the trigger never fired" are NOT reasons — they describe the item's history, not its merit. The bar is the same one `/tzurot-review-response` applies to origin-language: say why the work isn't worth doing, or don't remove it.
- **Rule out on merit, not on cost of doing it.** "This would take a while" is a reason to schedule it, not to drop it.
- **Anything with user-visible impact, product taste, or a security/data dimension is the owner's call**, not the agent's. Agents rule out technical nits on technical grounds; everything else gets surfaced. **This boundary fails closed: if you aren't sure it's a nit, it isn't one** — surface it or leave it filed. Every other decision point in this corpus defaults to the safe side (the review-response whitelist to semantic, out-of-scope to tracking); this one deletes work when it guesses wrong, so it gets the same default.
- **Removal is one commit's worth of evidence.** A batch removal names each item and its reason — a single "cleaned up stale rows" commit is exactly the rug this exit must not become.

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
- **Did every rule-out decided this session actually get committed?** The third exit is the only one with no PR gate behind it — a rule-out lives or dies on someone making the removing commit, and a decision that stayed in chat prose removed nothing. Check the same way as additions: name each item ruled out this session and confirm its commit exists.

**Strike through sub-items at absorption, not at PR close.** Umbrella entries (multi-item audits, grouped follow-ups) don't track sub-item resolution automatically: when a PR resolves ONE sub-item of an umbrella entry, strike it through in the same working session as the resolving PR — waiting for "later" is how umbrella entries silently rot into half-done.

Both gates pair with the session-end workflow in the `/tzurot-docs` skill.

## Triage Rules — where does a new item go?

Clear the **admission bar** above first — an item whose trigger is this same file/diff is done now, and a named cross-file batch is filed as the batch. Only what survives that gets a destination below, by size/granularity (see the ladder); trigger is a field, not a bucket.

| If the item is...                                                | Goes to...                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Fixable in the work that surfaced it                             | **Nowhere — do it now** (admission bar above)                       |
| Active production bug                                            | `now.md` › 🚨 Production Issues                                     |
| Needed this week                                                 | `now.md` › 🎯 Current Focus (max 3)                                 |
| Small (<~2hr), independent, one sentence, **observable trigger** | `now.md` › ⚡ Quick Wins (max 5) if soon; else `cold/follow-ups.md` |
| Part of the active epic                                          | `active-epic.md` (slice detail → `cold/epic-log.md`)                |
| A single feature needing scoping                                 | `cold/ideas.md` (`##` section)                                      |
| A multi-phase initiative                                         | `cold/themes/<slug>.md` + bullet in `cold/queue.md`                 |
| Arrived mid-session, no time to triage                           | `now.md` › 📥 Untriaged (max 10), route later                       |

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
| Delete an item because it's old    | Aging escalates priority — act on it, or rule it out on merit.    |
| File a "next time we touch this"   | Touch it now — it's colocated and small (admission bar above).    |
| Have multiple "Active Epics"       | One epic. The rest live in `cold/queue.md`.                       |
| Add items without context          | Include why, what, and acceptance.                                |
| Load `cold/` at session start      | It's grep-on-demand; only the HOT files load every session.       |

## Tags

Use consistently across all files:

- 🏗️ `[LIFT]` — Refactor/tech debt
- ✨ `[FEAT]` — New feature
- 🐛 `[FIX]` — Bug fix
- 🧹 `[CHORE]` — Maintenance/cleanup
