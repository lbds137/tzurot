# Backlog Management

## Structure

`BACKLOG.md` is the load manifest (HOT/COLD surfaces, filing tree). `tracker/` is queried on demand, never loaded wholesale; `backlog/cold/` is grep-on-demand; `CURRENT.md` is owned by `/tzurot-docs`.

## The tracker store (small items)

Commands: `BACKLOG.md` § The tracker store.

`--search` is fuzzy over title AND body: high recall, low precision (one term returned ~130 tasks, mostly noise; a nonsense string returns 0). An EMPTY result is real evidence of absence and can back a "we don't have X" claim alongside the other vocabulary variants. A non-empty count means nothing until the hits are read; never report "N tasks match".

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
- **Prefer CLI edits over hand edits for frontmatter** (`pnpm ops backlog` fails on unparsable files and missing axes).
- **Finishing**: `-s Done` at ship — **the digest excludes Done, `task list` does NOT**, so every selection query needs an explicit `-s "To Do"`. Archive (`pnpm tracker task archive <id>`) during periodic sweeps; for **obsolete** or **ruled-out** exits, archive with the reason in the removing commit.

### The admission bar

**Filing a task requires no trigger.** Selection is driven by queries — area/size/state/priority plus the digest's aging surface — not by anyone remembering a condition; a `Promote when:` annotation is metadata, never the mechanism. Two admission checks survive, because they change the _destination_, not the bar:

- **This same file or diff** ("next time we touch this") → **do it now**, in the work that surfaced it; filing it converts a five-minute edit into pool weight.
- **A named batch across files** ("next tooling-DRY pass"), or simply too big for this diff → **file the batch, not the item**; a theme-doc phase or idea doc owns the pass, and this item is one of its members.
- Anything else small → **file it as a task.** No trigger needed — with one scoped inversion, low-priority process residue, below.

**Which one, for a batch**: if the whole pass is one PR's worth of sweeping, it's an idea doc. If it needs its own phased rollout, it's a theme doc. **Search before creating the batch** — `pnpm tracker task list --search <term> --plain` AND `pnpm tracker doc search <term>` by the pass's name and the module it sweeps; if an entry already owns the pass, add the item as a member instead of fragmenting.

### The process-residue default

**Low-priority residue from process work is dispositioned in the PR body, not filed.** Process work is a PR whose substance lies under `.claude/`, `.husky/`, `packages/tooling/`, or `.github/`, with bookkeeping under `tracker/`, `backlog/`, `docs/`, or the root markdown files free to ride along; a diff that touches any runtime file (runtime as `10-working-posture.md` § Ship in bounded units defines it, plus `packages/test-utils/` and `packages/test-factories/`) is not process work, and its residue files. Residue is the tail such PRs leave — a fail-open branch, an unprobed guard arm, a "tune it if it proves noisy" watch, the nits at a review-round cap — whose only trigger is the next touch of the same file, so a task for it is pool weight no query surfaces. File it only when it earns `medium` or above on the priority axis: `medium` for a cost measured rather than hypothesized, `high` for a prod-correctness or data-rights dimension.

In the PR body: a `## Residue` section, one line per item — what it is, its file in backticks, and exactly one disposition: **fixed** here, **declined** with the technical reason (the ruled-out bar below applies unchanged — merit, not effort; "pre-existing" is never the reason), or **filed** as `TASK-N` with the sentence that earns it `medium` or above. A residue line names no future PR and no trigger. The owner-call boundary in harness `core.md` § Everything not done gets a disposition when you decide fails closed here too — if declining feels wrong, that is the `medium` signal, file it.

## Staleness — aging escalates, it never deletes

Items are **never** deleted by calendar. The digest's oldest-20 surface exists so aged items get a conscious decision (do it now / leave it filed). An item leaves the backlog on exactly **three** exits, and no others:

- **done** (shipped — `-s Done`, archive later; git is the archive for markdown entries);
- **genuinely obsolete** — the code path, file, or condition it references no longer exists. Verify by grep before removing, not by date; or
- **ruled out** — a deliberate decision that we are not going to do this. Rationale goes in the removing commit, never a tombstone entry.

**Removing a tracker doc**: grep its `doc-N` first and rewrite every mention to prose in the same commit (`checkDocIdRefs` fails otherwise).

### Ruling an item out

The ruled-out exit is deliberately narrow — merit-vs-cost and the owner-call boundary are harness `core.md` § Everything not done gets a disposition when you decide.

- **A technical reason is required, stated in the removing commit.** "It's old," "nobody got to it," "pre-existing," and "the trigger never fired" describe the item's history, not its merit — say why the work isn't worth doing, or don't remove it.
- **Removal is one commit's worth of evidence.** A batch removal names each item and its reason; a single "cleaned up stale rows" commit does not.

## Session Workflow

### Starting a Session

1. `CURRENT.md` is injected by the session-start hook; don't re-Read it.
2. Read `backlog/now.md` — 🚨 Production Issues fix first; then continue 🎯 Current Focus
3. Run `pnpm ops backlog:digest` for the tracker briefing (areas · oldest · newest)
4. When two entries share a symptom, check whether they're one seam.
5. If Current Focus is empty, pull from ⚡ Quick Wins (in `now.md`), `backlog/active-epic.md`, or the digest's oldest surface
6. **Repo-state sweep** — the owner should never discover these mid-session: `gh pr list --author app/dependabot` (waiting dependabot PRs); `git fetch -p && git branch -r --no-merged origin/develop` (dangling remote branches — grep `tracker/` and `backlog/` for the branch name for a recorded parked disposition before flagging one); any red or silently-empty workflow run on open PRs (the SHA-pinned `actions/runs?head_sha=…` query in `05-tooling.md` § PR Monitoring); and any overdue periodic pass the session-start hook prints (`pnpm ops cadence:status` for the full ledger). Surface findings in the session-start summary.

## Out-of-Scope Items Must Be Tracked

Harness `core.md` § Fix what you touch, file what you find / § Everything not done gets a disposition when you decide governs. Tzurot destination: a tracker task or `backlog/**/*.md`; the one exception is process residue in the PR body's `## Residue`. **The promise ledger — file at the moment of utterance**: the reply that files it names the id ("filed as TASK-N"); `promise-ledger-check.sh` (Stop hook) blocks a turn-end that promises deferred work with no same-turn backlog write.

### Plan-level requirement

Plan files produced in plan mode must include a "Backlog Additions Required" section enumerating every known-defect out-of-scope item with its **destination**, the **problem** (a paragraph), the **action** (concrete steps), and **why it's out of scope** (one sentence).

Session-end gates (additions and removals): `/tzurot-docs` § Session End Procedure step 5.

## Triage Rules — where does a new item go?

Filing decision-tree: `BACKLOG.md` § Where does a new item go?
