# Backlog Management

## Structure

Three surfaces, by granularity:

- **`tracker/`** — the [Backlog.md](https://backlog.md) store, CLI-owned, **queried on demand — never loaded wholesale**: one task file per small item (`tracker/tasks/`), one doc per theme or idea (`tracker/docs/`, shared search index).
- **`backlog/`** — the curated working state (HOT, below) plus two COLD index files: the theme queue, the epic log.
- **`CURRENT.md`** — session status and smoke-checklist state (owned by `/tzurot-docs`).

### HOT — read at session start

- `BACKLOG.md` (root) — load manifest + filing decision-tree
- `backlog/now.md` — 🚨 Production Issues · 🚢 Next Release (the release plan — `10-working-posture.md` § Ship in bounded units) · 🎯 Current Focus (max 3) · ⚡ Quick Wins (max 5) · 📥 Untriaged (max 10)
- `backlog/active-epic.md` — the ONE current major initiative: roadmap + current phase
- `backlog/references.md` — cross-links to research docs / post-mortems
- `pnpm ops backlog:digest` — generated tracker briefing: per-area counts · owner queue · oldest 20 (aging surface) · newest 10

### COLD — grep-on-demand, NEVER auto-loaded

`backlog/cold/queue.md` (ordered index of future themes → tracker theme docs) and `backlog/cold/epic-log.md` (per-PR slice log for the Active Epic). Theme and idea CONTENT lives in `tracker/docs/`; `queue.md` carries only the ordering.

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

**Apostrophes silently break the `$'...'` description**: the usual escape
`'"'"'` CLOSES the ANSI-C string, so every later `\n` files as a literal
backslash-n. Avoid the apostrophe, or write the body by editing the task file
directly — and **read the file back after creating a task with a
multi-paragraph description** (`pnpm ops backlog` cannot see a mangled body).

**Repeated `-l` flags do not accumulate on `task create`** — only the last survives; use the comma form `-l area:x,size:S,state:ready`. (Repeated `-l` on `task list` DOES intersect.)

- **A task description carries why, what, and acceptance.** `Promote when: <event>` is an optional annotation (see the admission bar).
- **An architecture/infrastructure premise stated in a description cites the file:line that verifies it.**
- **Labels**: `area:<package-or-domain>` (db, redis, voice, bot-client, …), set at filing.
- **Size + priority** (set at filing): `size:S` (<~1hr, one file) / `size:M` (a PR) / `size:L` (multi-PR or needs design), plus the CLI priority field — `high` (prod-correctness / data-rights adjacent) · `medium` (real improvement, no urgency) · `low` (gated, speculative, or watch items).
- **State** (set at filing; exactly one) — the _reachability_ axis: `state:ready` (startable today) · `state:observable` (a signal arrives on its own — watches) · `state:dependent` (a named internal blocker) · `state:owner` (the owner's decision queue). None of size, priority, state substitutes for another. The drain query: `pnpm tracker task list -s "To Do" -l state:ready -l size:S --priority high --plain`. `state:owner` tasks also carry `Owner question: <one sentence>` and `Recommendation: <pick> — <reason>` lines (gated by `pnpm ops backlog`, rendered by the digest's Owner queue).
  - There is deliberately no state for "the only trigger is next time someone touches this" — that is the admission bar's **do it now** case; such an item belongs in the diff that surfaced it, not in the pool.
- **All four axes are gated** by `pnpm ops backlog` on every OPEN task — a missing label is indistinguishable from absent work.
- **Finishing**: `-s Done` at ship — **the digest excludes Done, `task list` does NOT**, so every selection query needs an explicit `-s "To Do"`. Archive during periodic sweeps; for **obsolete** or **ruled-out** exits, archive with the reason in the removing commit.
- **Integrity is gated**: `pnpm ops backlog` (in `pnpm quality` + CI) fails on any task file whose frontmatter won't parse. Prefer CLI edits over hand edits for anything touching frontmatter.

### The granularity ladder

File a "not now" item by **size**: a multi-phase initiative → theme doc (`pnpm tracker doc create 'Theme: …'`) + a `cold/queue.md` bullet; a single feature needing scoping → idea doc (`'Idea: …'`); one sentence, ~<2hr → `tracker/` task (`pnpm tracker task create`).

### The admission bar

**Filing a task requires no trigger.** Selection is driven by queries — area/size/state/priority plus the digest's aging surface — not by anyone remembering a condition; a `Promote when:` annotation is metadata, never the mechanism. Two admission checks survive, because they change the _destination_, not the bar:

- **This same file or diff** ("next time we touch this") → **do it now**, in the work that surfaced it; filing it converts a five-minute edit into pool weight.
- **A named batch across files** ("next tooling-DRY pass"), or simply too big for this diff → **file the batch, not the item**; a theme-doc phase or idea doc owns the pass, and this item is one of its members.
- Anything else small → **file it as a task.** No trigger needed — with one scoped inversion, low-priority process residue, below.

**Which one, for a batch**: if the whole pass is one PR's worth of sweeping, it's an idea doc. If it needs its own phased rollout, it's a theme doc. **Search before creating the batch** — `pnpm tracker task list --search <term> --plain` AND `pnpm tracker doc search <term>` by the pass's name and the module it sweeps; if an entry already owns the pass, add the item as a member instead of fragmenting.

### The process-residue default

**Low-priority residue from process work is dispositioned in the PR body, not filed.** Process work is a PR whose substance lies under `.claude/`, `.husky/`, `packages/tooling/`, or `.github/`, with bookkeeping under `tracker/`, `backlog/`, `docs/`, or the root markdown files free to ride along; a diff that touches any runtime file (runtime as `10-working-posture.md` § Ship in bounded units defines it, plus `packages/test-utils/` and `packages/test-factories/`) is not process work, and its residue files. Residue is the tail such PRs leave — a fail-open branch, an unprobed guard arm, a "tune it if it proves noisy" watch, the nits at a review-round cap — whose only trigger is the next touch of the same file, so a task for it is pool weight no query surfaces. File it only when it earns `medium` or above on the priority axis: `medium` for a cost measured rather than hypothesized, `high` for a prod-correctness or data-rights dimension.

In the PR body: a `## Residue` section, one line per item — what it is, its file in backticks, and exactly one disposition: **fixed** here, **declined** with the technical reason (the ruled-out bar below applies unchanged — merit, not effort; "pre-existing" is never the reason), or **filed** as `TASK-N` with the sentence that earns it `medium` or above. A residue line names no future PR and no trigger. The owner-call boundary in § Ruling an item out fails closed here too — if declining feels wrong, that is the `medium` signal, file it.

## Staleness — aging escalates, it never deletes

Items are **never** deleted by calendar. The digest's oldest-20 surface exists so aged items get a conscious decision (do it now / leave it filed). An item leaves the backlog on exactly **three** exits, and no others:

- **done** (shipped — `-s Done`, archive later; git is the archive for markdown entries);
- **genuinely obsolete** — the code path, file, or condition it references no longer exists. Verify by grep before removing, not by date; or
- **ruled out** — a deliberate decision that we are not going to do this. Rationale goes in the removing commit, never a tombstone entry (`00-critical.md` § Always Leave Code Better Than You Found It).

**Removing or renumbering a tracker doc has a gate cost — pay it in the same commit.** `pnpm ops backlog` (`checkDocIdRefs` in `backlogLint.ts`) resolves every backticked `doc-N` mention across `backlog/**`, `tracker/tasks/**`, and `tracker/docs/**` against the live `tracker/docs/` filenames, fenced code blocks included — so a made-up id in an example fails too. Grep for the id first, and rewrite those mentions to prose in the removing commit.

### Ruling an item out

The ruled-out exit is deliberately narrow:

- **A technical reason is required, stated in the removing commit.** "It's old," "nobody got to it," "pre-existing," and "the trigger never fired" describe the item's history, not its merit — say why the work isn't worth doing, or don't remove it.
- **Rule out on merit, not on cost of doing it.** "This would take a while" is a reason to schedule it, not to drop it.
- **Anything with user-visible impact, product taste, or a security/data dimension is the owner's call**, not the agent's. Agents rule out technical nits on technical grounds; everything else gets surfaced. **This boundary fails closed: if you aren't sure it's a nit, it isn't one** — surface it or leave it filed.
- **Removal is one commit's worth of evidence.** A batch removal names each item and its reason; a single "cleaned up stale rows" commit does not.

## Session Workflow

### Starting a Session

1. Read `CURRENT.md` for context
2. Read `backlog/now.md` — 🚨 Production Issues fix first; then continue 🎯 Current Focus
3. Run `pnpm ops backlog:digest` for the tracker briefing (areas · oldest · newest)
4. **Freshness-check before presenting**: a board entry is a snapshot, not a fact. Before presenting a Production Issue as live, verify it against reality (git log for fixes that already landed, the user's runtime experience, recent release notes). When two entries share a symptom, check whether they're one underlying seam.
5. If Current Focus is empty, pull from ⚡ Quick Wins (in `now.md`), `backlog/active-epic.md`, or the digest's oldest surface
6. **Repo-state sweep** — the owner should never discover these mid-session: `gh pr list --author app/dependabot` (waiting dependabot PRs); `git fetch -p && git branch -r --no-merged origin/develop` (dangling remote branches — grep `tracker/` and `backlog/` for the branch name for a recorded parked disposition before flagging one); any red or silently-empty workflow run on open PRs (the SHA-pinned `actions/runs?head_sha=…` query in `05-tooling.md` § PR Monitoring); and any overdue periodic pass the session-start hook prints (`pnpm ops cadence:status` for the full ledger). Surface findings in the session-start summary.
7. Do NOT load `backlog/cold/` or `tracker/tasks/` wholesale — grep/query on demand

### Ending a Session

1. Update `CURRENT.md` with session progress
2. Mark shipped tracker tasks Done; remove shipped items from `backlog/now.md` (and any `cold/` file that tracked them)
3. Capture new items per the filing decision-tree (see `BACKLOG.md`); `now.md` › 📥 Untriaged only for mid-session parking
4. Keep the caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10

## Out-of-Scope Items Must Be Tracked

Marking something "out of scope" is NOT permission to ignore it. Any known defect, inconsistency, or technical deficiency you decide not to fix in the current work **must** land in a concrete destination — a tracker task or the appropriate `backlog/**/*.md` file, or, for low-priority residue of process work only, the PR body's `## Residue` section (§ The process-residue default). Applies to plans, PRs, code reviews, and ad-hoc work.

**Commit messages, PR bodies, plan notes, and code comments are NOT substitutes** (the `## Residue` section is the one scoped exception). A `// TODO: migrate this later` comment does not count as tracking. If the follow-up matters enough to mention anywhere, it is a task before the current work closes.

**The promise ledger — file at the moment of utterance.** Any in-flight "I'll do X later / after this PR / when the release is done" — in chat, a plan, or a PR description — lands in a tracker task or backlog file (or, for process residue, the `## Residue` section) THE MOMENT it is said, not at session end; a promise in chat prose dies at the next compaction. The session-end gates below are the backstop. The reply that files the task names its id back to the owner ("filed as TASK-N").

### Two types of "out of scope" — only one needs tracking

- **(a) Design decision** — current code is fine; you're declining an extraction/refactor as over-abstraction. **Not tracked**: a judgment call, not a defect.
- **(b) Known defect** — something is wrong (bug, naming drift, stale entry, duplicated code) but fixing it would bloat the PR or needs separate design. **Tracked**: a concrete entry with a destination.

When uncertain between (a) and (b), **err toward tracking**.

### Plan-level requirement

Plan files produced in plan mode must include a "Backlog Additions Required" section enumerating every type-(b) out-of-scope item with its **destination**, the **problem** (a paragraph), the **action** (concrete steps), and **why it's out of scope** (one sentence).

### Session-end gate (additions)

A session is NOT done until every promised backlog addition is written to its promised destination: re-read the plan's "Backlog Additions Required" section and verify each item exists (`pnpm tracker task list --search <term> --plain` for tasks; the file for markdown entries). Write any missing ones first.

### Session-end gate (removals)

A session is ALSO not done until every item that shipped during the session is closed out:

- List the PRs merged during the session
- For each PR, search the tracker (`--search` by title/topic), `pnpm tracker doc search`, AND grep `backlog/` (recursive) — mark any matching entry Done / **remove it**
- **When a merged PR completes a PHASE (or the last slice) of a theme doc, grep the doc id — `grep -rn 'doc-N' backlog/ tracker/docs/` — and rewrite every hit's status words.** A PR-title grep never matches a roadmap line that names the epic by id ("doc-12 closes Phase A", "Phase 2 is queued"): two shipped phases sat marked queued/untouched in `cold/queue.md` for four weeks that way.
- For any entry annotated "PROMOTED to Current Focus" or similar, re-verify the fix actually shipped; if yes, remove
- Remove any entry whose fix-shape points to code that no longer needs fixing (grep the file to confirm) — the "genuinely obsolete" path, not time-based pruning
- **Did every rule-out decided this session actually get committed?** Name each item ruled out this session and confirm its commit exists — a decision that stayed in chat removed nothing.

**Strike through sub-items at absorption, not at PR close.** When a PR resolves ONE sub-item of an umbrella entry (multi-item audit, grouped follow-ups), strike it through in the same working session.

Both gates pair with the session-end workflow in the `/tzurot-docs` skill.

## Triage Rules — where does a new item go?

Clear the **admission bar** above first — same-file/diff work is done now, and a named cross-file batch is filed as the batch. Only what survives that gets a destination below, by size/granularity:

- Fixable in the work that surfaced it → **nowhere — do it now** (admission bar above)
- Active production bug → `now.md` › 🚨 Production Issues
- Needed this week → `now.md` › 🎯 Current Focus (max 3)
- Small (<~2hr), independent, and you'll actually do it soon → `now.md` › ⚡ Quick Wins (max 5)
- Small, one sentence — everything else → `tracker/` task (`pnpm tracker task create`)
- Low-priority residue of process work → the PR body's `## Residue` section (§ The process-residue default)
- Part of the active epic → `active-epic.md` (slice detail → `cold/epic-log.md`)
- A single feature needing scoping → idea doc (`pnpm tracker doc create 'Idea: …'`)
- A multi-phase initiative → theme doc (`'Theme: …'`) + bullet in `cold/queue.md`
- Arrived mid-session, no time to triage → `now.md` › 📥 Untriaged (max 10), route later

### Promoting a theme to Active Epic

When the Active Epic completes:

0. **Re-touch the system map**: walk [`docs/reference/architecture/system-model.md`](../../docs/reference/architecture/system-model.md) asking "what did this epic change?" and apply the edits — or record "no map impact" in the epic close-out. (Mid-epic, file a drift note when a PR changes something the map describes — never auto-append; its ~150-line budget forces eviction, not growth.)
1. Remove the finished epic from `active-epic.md`, folding any still-relevant follow-on into `cold/` or tracker tasks.
2. Pick the next theme from `cold/queue.md` by dependency + value — a substantial pick gets a council pass before plan-mode.
3. Move that theme doc's content (`pnpm tracker doc view <id>`) into `active-epic.md` (slim roadmap in the hot file; dense per-PR detail to `cold/epic-log.md`) and remove its `cold/queue.md` bullet.

## Theme/Epic Structure

A theme doc (`tracker/docs/`, `Theme:`-titled) or the active epic is headed `### Theme: Name`, carries a `_Focus: one-sentence goal._` line, then `### Phase N — ...` headings (marked ✅ DONE / NEXT) holding checkbox tasks with their dependencies noted.

## Tags

Use consistently across the `backlog/` markdown files (tracker tasks use `area:*` labels instead):

- 🏗️ `[LIFT]` — Refactor/tech debt
- ✨ `[FEAT]` — New feature
- 🐛 `[FIX]` — Bug fix
- 🧹 `[CHORE]` — Maintenance/cleanup
