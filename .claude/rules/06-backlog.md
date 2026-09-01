# Backlog Management

## Structure

Three surfaces, by granularity:

- **`tracker/`** — the [Backlog.md](https://backlog.md) store, CLI-owned, **queried on demand — never loaded wholesale**: one task file per small item (`tracker/tasks/`), one doc per theme or idea (`tracker/docs/`, shared search index).
- **`backlog/`** — the curated working state (HOT, below) plus two COLD index files: the theme queue, the epic log.
- **`CURRENT.md`** — session status and smoke-checklist state (owned by `/tzurot-docs`).

### HOT — read at session start

| Surface                   | Contents                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BACKLOG.md` (root)       | Load manifest + filing decision-tree                                                                                                                                                       |
| `backlog/now.md`          | 🚨 Production Issues · 🚢 Next Release (the release plan — see `10-working-posture.md` § Ship in bounded units) · 🎯 Current Focus (max 3) · ⚡ Quick Wins (max 5) · 📥 Untriaged (max 10) |
| `backlog/active-epic.md`  | The ONE current major initiative: roadmap + current phase                                                                                                                                  |
| `backlog/references.md`   | Cross-links to research docs / post-mortems                                                                                                                                                |
| `pnpm ops backlog:digest` | Generated tracker briefing: per-area counts · oldest 20 (aging surface) · newest 10                                                                                                        |

### COLD — grep-on-demand, NEVER auto-loaded

| File                       | Contents                                                                 |
| -------------------------- | ------------------------------------------------------------------------ |
| `backlog/cold/queue.md`    | Ordered index of future themes → references tracker theme docs (`doc-N`) |
| `backlog/cold/epic-log.md` | Detailed per-PR slice log for the Active Epic                            |

(Theme and idea CONTENT lives in `tracker/docs/` — see the tracker store below; `queue.md` carries only the ordering.)

## The tracker store (small items)

The CLI owns the file shape; interact through it:

```bash
pnpm tracker task create 'Title' -d $'Why: ...\nFix shape: ...' -l area:db   # file
pnpm tracker task list --search <term> --plain                              # query by text
pnpm tracker task list -l area:<x> --plain                                  # query by area
pnpm tracker task edit <id> -s Done                                         # finish at ship
pnpm tracker task archive <id>                                              # obsolete / ruled out
pnpm tracker doc search <query>                                             # search theme/idea docs (shared index)
pnpm tracker doc view <doc-id>                                              # read one doc
pnpm tracker doc create 'Idea: Title'                                       # file a paragraph idea (fill body after create)
pnpm ops backlog:digest                                                     # the briefing
```

**Apostrophes silently break the `$'...'` description.** `$'…'` is what makes
`\n` a real newline, and the usual way to get an apostrophe inside it —
`'"'"'` — CLOSES the ANSI-C string, so every `\n` after it files as a literal
backslash-n on one unreadable line. Avoid the apostrophe, or write the body by
editing the task file directly. Either way **read the file back after creating a
task with a multi-paragraph description** — `pnpm ops backlog` gates on
frontmatter parsing and cannot see a mangled body.

**Repeated `-l` flags do not accumulate on `task create`** — only the last survives. Use the comma form: `-l area:x,size:S,state:ready`. (Repeated `-l` on `task list` DOES intersect, so the drain query below is fine as written.)

- **A task description carries why, what, and acceptance** — same bar as any backlog entry. `Promote when: <event>` is an optional annotation (see the admission bar).
- **An architecture/infrastructure premise stated in a description cites the file:line that verifies it** — a task filed on an unverified premise plants that premise in a durable surface (the same cite-the-read bar PR bodies carry).
- **Labels**: `area:<package-or-domain>` (db, redis, voice, bot-client, …). Label at filing; the digest's per-area counts are the jump-around index.
- **Size + priority** (set at filing; every existing task carries them): `size:S` (<~1hr, one file) / `size:M` (a PR) / `size:L` (multi-PR or needs design) labels, plus the CLI priority field — `high` (prod-correctness / data-rights adjacent) · `medium` (real improvement, no urgency) · `low` (gated, speculative, or watch items).
- **State** (set at filing; exactly one) — the _reachability_ axis, answering "what has to happen before anyone can pick this up": `state:ready` (startable today) · `state:observable` (a signal arrives on its own — watches) · `state:dependent` (a named internal blocker) · `state:owner` (the owner's decision queue). Size says how big, priority says how much it matters, state says whether it can be started at all — none substitutes for another. The drain query: `pnpm tracker task list -s "To Do" -l state:ready -l size:S --priority high --plain`.
  - There is deliberately no state for "the only trigger is next time someone touches this" — that is the admission bar's **do it now** case, so a task in it should never have been filed. An item with no reachable trigger belongs in the diff that surfaced it, not in the pool.
- **All four axes are gated** by `pnpm ops backlog` on every OPEN task, because a missing label is indistinguishable from absent work: a filter that returns nothing reads as "no such task", never as "the label is missing".
- **Finishing**: `-s Done` at ship — **the digest excludes Done, `task list` does NOT**, so every selection query needs an explicit `-s "To Do"` (without it the drain query silently offers closed work as pickable). Archive during periodic sweeps. For **obsolete** or **ruled-out** exits, archive with the reason in the removing commit.
- **Integrity is gated**: `pnpm ops backlog` (in `pnpm quality` + CI) fails on any task file whose frontmatter won't parse — a broken task silently vanishes from every query. Prefer CLI edits over hand edits for anything touching frontmatter.

### The granularity ladder

File a "not now" item by **size**: a multi-phase initiative → theme doc (`pnpm tracker doc create 'Theme: …'`) + a `cold/queue.md` bullet; a single feature needing scoping → idea doc (`'Idea: …'`); one sentence, ~<2hr → `tracker/` task (`pnpm tracker task create`).

### The admission bar

**Filing a task requires no trigger.** Selection is driven by queries — area/size/state/priority plus the digest's aging surface — not by anyone remembering a condition. A `Promote when:` annotation is welcome metadata for the reader who finds the task; it is never the mechanism that surfaces it. Two admission checks survive, because they change the _destination_, not the bar:

- **This same file or diff** ("next time we touch this") → **do it now**, in the work that surfaced it; filing it converts a five-minute edit into pool weight.
- **A named batch across files** ("next tooling-DRY pass"), or simply too big for this diff → **file the batch, not the item**; a theme-doc phase or idea doc owns the pass, and this item is one of its members.
- Anything else small → **file it as a task.** No trigger needed.

**Which one, for a batch**: if the whole pass is one PR's worth of sweeping, it's an idea doc. If it needs its own phased rollout, it's a theme doc. **Search before creating the batch** — `pnpm tracker task list --search <term> --plain` AND `pnpm tracker doc search <term>` by the pass's name and the module it sweeps; if an entry already owns the pass, add the item as a member instead of fragmenting.

## Staleness — aging escalates, it never deletes

Items are **never** deleted by calendar. The digest's oldest-20 surface exists so aged items get a conscious decision (do it now / leave it filed). An item leaves the backlog on exactly **three** exits, and no others:

- **done** (shipped — `-s Done`, archive later; git is the archive for markdown entries);
- **genuinely obsolete** — the code path, file, or condition it references no longer exists. Verify by grep before removing, not by date; or
- **ruled out** — a deliberate decision that we are not going to do this. Rationale goes in the removing commit, never a tombstone entry (`00-critical.md` § Always Leave Code Better Than You Found It).

### Ruling an item out

`10-working-posture.md` names four honest states for anything not-done — shipped, obsolete, **ruled out**, deferred. The ruled-out exit is deliberately narrow:

- **A technical reason is required, stated in the removing commit.** "It's old," "nobody got to it," "pre-existing," and "the trigger never fired" are NOT reasons — they describe the item's history, not its merit. Say why the work isn't worth doing, or don't remove it.
- **Rule out on merit, not on cost of doing it.** "This would take a while" is a reason to schedule it, not to drop it.
- **Anything with user-visible impact, product taste, or a security/data dimension is the owner's call**, not the agent's. Agents rule out technical nits on technical grounds; everything else gets surfaced. **This boundary fails closed: if you aren't sure it's a nit, it isn't one** — surface it or leave it filed.
- **Removal is one commit's worth of evidence.** A batch removal names each item and its reason; a single "cleaned up stale rows" commit does not.

## Session Workflow

### Starting a Session

1. Read `CURRENT.md` for context
2. Read `backlog/now.md` — 🚨 Production Issues fix first; then continue 🎯 Current Focus
3. Run `pnpm ops backlog:digest` for the tracker briefing (areas · oldest · newest)
4. **Freshness-check before presenting**: a board entry is a snapshot, not a fact. Before presenting a Production Issue as live, verify it against reality (git log for fixes that already landed, the user's own runtime experience, recent release notes). When two entries share a symptom, check whether they're one underlying seam.
5. If Current Focus is empty, pull from ⚡ Quick Wins (in `now.md`), `backlog/active-epic.md`, or the digest's oldest surface
6. **Repo-state sweep** — the owner should never be the one to discover these mid-session: `gh pr list --author app/dependabot` (waiting dependabot PRs), `git fetch -p && git branch -r --no-merged origin/develop` (dangling remote branches — before flagging one, grep `tracker/` and `backlog/` for the branch name to find its recorded parked disposition), and any red or silently-empty workflow run on open PRs (the SHA-pinned `actions/runs?head_sha=…` query in `05-tooling.md` § PR Monitoring — it catches the died-before-dispatch case `gh pr checks` structurally cannot show). Surface findings in the session-start summary.
7. Do NOT load `backlog/cold/` or `tracker/tasks/` wholesale — grep/query on demand

### Ending a Session

1. Update `CURRENT.md` with session progress
2. Mark shipped tracker tasks Done; remove shipped items from `backlog/now.md` (and any `cold/` file that tracked them)
3. Capture new items per the filing decision-tree (see `BACKLOG.md`); `now.md` › 📥 Untriaged only for mid-session parking
4. Keep the caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10

## Out-of-Scope Items Must Be Tracked

Marking something "out of scope" is NOT permission to ignore it. Any known defect, inconsistency, or technical deficiency you decide not to fix in the current work **must** land in a concrete destination — a tracker task or the appropriate `backlog/**/*.md` file. Applies to plans, PRs, code reviews, and ad-hoc work.

**Commit messages, PR bodies, plan notes, and code comments are NOT substitutes.** A `// TODO: migrate this later` comment does not count as tracking — nobody greps commit history or scattered comments looking for deferred work. If the follow-up matters enough to mention anywhere, it matters enough to be a task before the current work closes.

**The promise ledger — file at the moment of utterance.** Any in-flight "I'll do X later / after this PR / when the release is done" — in chat, a plan, or a PR description — must land in a tracker task or the appropriate backlog file THE MOMENT it is said, not at session end. A promise that exists only in chat prose does not exist: it dies at the next compaction. The session-end gates below are the backstop, not the mechanism.

### Two types of "out of scope" — only one needs tracking

- **(a) Design decision** — current code is fine; you're declining to extract/refactor because it would be over-abstraction ("not extracting this helper — trades 5 lines of linear code for 8 lines of options-object ceremony"). **Not tracked**: a judgment call, not a defect.
- **(b) Known defect** — something is wrong (bug, naming drift, stale entry, duplicated code) but fixing it would bloat the PR or needs separate design ("file is `settings.ts` but the command is `/channel context`; four-layer naming drift"). **Tracked**: a concrete entry with a destination.

When uncertain between (a) and (b), **err toward tracking**.

### Plan-level requirement

Plan files produced in plan mode must include a "Backlog Additions Required" section enumerating every type-(b) out-of-scope item with its **destination**, the **problem** (a paragraph), the **action** (concrete steps), and **why it's out of scope** (one sentence).

### Session-end gate (additions)

A session is NOT done until every promised backlog addition is actually written to its promised destination. Before session-end cleanup, re-read the plan's "Backlog Additions Required" section and verify each item exists where it was promised (`pnpm tracker task list --search <term> --plain` for tasks; the file for markdown entries). Write any missing ones first.

### Session-end gate (removals)

A session is ALSO not done until every item that shipped during the session is closed out. Additions without removals is what lets the backlog rot. Specifically:

- List the PRs merged during the session
- For each PR, search the tracker (`--search` by title/topic), `pnpm tracker doc search`, AND grep `backlog/` (recursive) — if a matching entry exists, mark it Done / **remove it**
- For any entry annotated "PROMOTED to Current Focus" or similar, re-verify the underlying fix actually shipped; if yes, remove
- Also remove any entry whose fix-shape hints point to code that no longer needs fixing (grep the file to confirm). This is the "genuinely obsolete" removal path — it's distinct from time-based pruning, which we do NOT do.
- **Did every rule-out decided this session actually get committed?** The third exit is the only one with no PR gate behind it — a decision that stayed in chat prose removed nothing. Name each item ruled out this session and confirm its commit exists.

**Strike through sub-items at absorption, not at PR close.** Umbrella entries (multi-item audits, grouped follow-ups) don't track sub-item resolution automatically: when a PR resolves ONE sub-item, strike it through in the same working session as the resolving PR.

Both gates pair with the session-end workflow in the `/tzurot-docs` skill.

## Triage Rules — where does a new item go?

Clear the **admission bar** above first — same-file/diff work is done now, and a named cross-file batch is filed as the batch. Only what survives that gets a destination below, by size/granularity:

| If the item is...                                           | Goes to...                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| Fixable in the work that surfaced it                        | **Nowhere — do it now** (admission bar above)               |
| Active production bug                                       | `now.md` › 🚨 Production Issues                             |
| Needed this week                                            | `now.md` › 🎯 Current Focus (max 3)                         |
| Small (<~2hr), independent — and you'll actually do it soon | `now.md` › ⚡ Quick Wins (max 5) — it's simply next in line |
| Small, one sentence — everything else                       | `tracker/` task (`pnpm tracker task create`)                |
| Part of the active epic                                     | `active-epic.md` (slice detail → `cold/epic-log.md`)        |
| A single feature needing scoping                            | idea doc (`pnpm tracker doc create 'Idea: …'`)              |
| A multi-phase initiative                                    | theme doc (`'Theme: …'`) + bullet in `cold/queue.md`        |
| Arrived mid-session, no time to triage                      | `now.md` › 📥 Untriaged (max 10), route later               |

### Promoting a theme to Active Epic

When the Active Epic completes:

0. **Re-touch the system map (~15 min)**: walk [`docs/reference/architecture/system-model.md`](../../docs/reference/architecture/system-model.md) asking "what did this epic change?" and apply the edits — or record "no map impact" in the epic close-out. (Mid-epic, the agent files a drift note when a PR changes something the map describes — it never auto-appends; the ~150-line budget forces eviction, not growth.)
1. Remove the finished epic from `active-epic.md` (git preserves it; fold any still-relevant follow-on into `cold/` or tracker tasks). Its detailed log in `cold/epic-log.md` can be deleted or kept as historical reference.
2. Pick the next theme from `cold/queue.md` (by dependency + value — each substantial pick deserves a council pass before plan-mode).
3. Move that theme doc's content (`pnpm tracker doc view <id>`) into `active-epic.md` (slim roadmap in the hot file; push dense per-PR detail to `cold/epic-log.md`). Remove its `cold/queue.md` bullet; the doc itself can be trimmed to a pointer or left as historical reference.

## Theme/Epic Structure

A theme doc (`tracker/docs/`, `Theme:`-titled) or the active epic is headed `### Theme: Name`, carries a `_Focus: one-sentence goal._` line, then `### Phase N — ...` headings (marked ✅ DONE / NEXT) holding checkbox tasks with their dependencies noted.

## Tags

Use consistently across the `backlog/` markdown files (tracker tasks use `area:*` labels instead):

- 🏗️ `[LIFT]` — Refactor/tech debt
- ✨ `[FEAT]` — New feature
- 🐛 `[FIX]` — Bug fix
- 🧹 `[CHORE]` — Maintenance/cleanup
