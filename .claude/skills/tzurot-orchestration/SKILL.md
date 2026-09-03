---
name: tzurot-orchestration
description: 'Orchestrator mode: when to delegate implementation to a worker agent, the spec template every worker gets, and the full-diff review gate before any commit. Invoke with /tzurot-orchestration at the start of any implementation unit run in orchestrator mode — the moment a task fix shape is known, before the first src Edit/Write.'
lastUpdated: '2026-09-03'
---

# Orchestrator Mode

**Invoke with /tzurot-orchestration** at the start of any implementation unit
run in orchestrator mode — the moment a task's fix shape is known, BEFORE the
first src Edit/Write.

## Why this procedure exists

Separating the drafting context from the judging context is what catches
confident-but-wrong work: the context that wrote a diff cannot see its own
assumptions, and a fresh reader can. The orchestrator's full-diff read is the
gate that stops worker defects before CI does.

## Mode decision table

Who drives the main loop determines the delegation posture. The mechanism is
quality — fresh context plus an independent diff review — not budget.

**Fable-driven NESTED DISPATCH is the PRIMARY workflow for routine work**
(owner verdict): Fable drives the main loop and dispatches one Opus
orchestrator + Sonnet worker per unit. **The Opus single-hop main loop is the
documented BACKUP lane** for when Fable usage runs low — a fallback, not a
deprecation. Release operations are **not** model-scoped: release safety rests
on the per-release owner-approval gate (`00-critical.md` § Merge Approval),
which is model-independent. Schema and migration work, and any owner-taste
call, still escalate to the owner regardless of driver.

| Driver                                          | Posture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fable main loop** _(PRIMARY — routine work)_  | **Nested dispatch is the STANDARD** — mechanics and contract in § Nested dispatch below; Fable's own full-diff read stays the gate. Inline only for: trivial mechanical edits (~≤5 lines), or work where writing the spec genuinely costs more than the edit. Review-round fixes are NOT an inline carve-out — batch each round's findings into one dispatch, preferring a SendMessage resume of the unit's own orchestrator (/tzurot-review-response § 3a).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Opus main loop** _(BACKUP — low Fable usage)_ | **Nested dispatch for SUBSTANTIVE units under this driver too** (owner call): one fresh Opus orchestrator + Sonnet worker per unit, same § Nested dispatch contract, with the Opus main loop's own full-diff read as the gate. The fresh-context layer, not the model tier, is the defect-catcher — a fresh instance of the SAME model re-verifies spec premises the authoring context cannot see past, and its marginal cost bills the non-binding budget. Mechanical-class units may go single-hop Sonnet (§ Worker model tier). But do NOT delegate work finishable in a handful of tool calls: Opus 5 over-delegates by documented tendency (prompting guide § controlling subagent spawning). Review-round fix batches are dispatch work under this driver too (/tzurot-review-response § 3a) — the handful-of-tool-calls exception never covers them: inline round-fixes are how self-fed review loops start. |
| **Bulk reading/exploration**                    | Explore/Plan agents, either driver. Reading fan-out is delegation's cheapest and least risky use. **Any read fan-out of ~4+ files, or any search across unknown locations, goes to `Explore` with `model: "haiku"` passed on the Agent call — never inline** (mechanism below the table).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Why Explore gets `model: "haiku"` per-call**: the built-in Explore inherits
the main-loop model (per the Agent tool's own schema: an omitted `model` "uses
the agent definition's model, or inherits from the parent" — inference from
that schema line, not a live probe), so an unpinned spawn bills the scarcest
budget, while every file read inline re-bills as main-loop input on all later
turns.

**Worker model tier (settled)**: for a **mechanical-class** unit — one whose
spec describes the edit precisely (renames, sweeps, fixture updates, applying
a settled pattern across files) — the orchestrator passes `model: sonnet` on
the Agent call instead of the default Opus model (same `opus-implementer`
contract, only the model overridden per-call); an edit that can be described
precisely does not need Opus-tier judgment to execute, and the spec template
produces exactly that. Sonnet is the STANDING tier for mechanical-class units. Semantic-class units (design judgment inside the
diff) stay on Opus. If a Sonnet unit ships a semantic defect: append it to
TASK-487's notes (that file is the tier's standing evidence ledger; its Done
status does not bar appends, and appends are file edits only — the CLI's
`--notes` flag REPLACES the whole section and has destroyed notes before)
AND drop mechanical-class delegation back to Opus for subsequent units.
Resume Sonnet only when the recorded analysis attributes the defect to
spec/scope rather than the worker tier, or the owner calls it.

## Nested dispatch — the Fable-driver standard

One Agent call (`subagent_type: "general-purpose"`, `model: "opus"`,
`isolation: "worktree"`) whose prompt IS a full orchestration spec — every
section of the spec template below, plus the nested-specific contract points
here. The Opus orchestrator grounds itself in the worktree, spawns ONE Sonnet
worker (`model: "sonnet"`, NO isolation flag — it must edit the
orchestrator's own worktree; absolute paths, `pwd` confirmed) for the
mechanical edits, runs every verification gate, and reports with verbatim gate
tails.

How this composes with § Worker model tier: that section's single-hop
`model: sonnet` dispatch is the OPUS-DRIVER rule and is unchanged. Under
nested dispatch the Opus layer is NOT skipped for mechanical-class units — the
layer is the quality mechanism (independent grounding, gates, and an honest
report), not a tier choice — and the inner worker stays Sonnet regardless of
unit class: semantic judgment inside the diff belongs to the ORCHESTRATOR
layer, which resolves it itself rather than promoting the worker.

The dispatch prompt's non-negotiable contract points:

- **Step 0 is base-SHA verification with the self-heal authorized** (§ "The
  base IS stale by default"). Name the SHA with its subject line. **Copy the
  four-condition self-heal block from that section VERBATIM — never
  paraphrase it**. A LOCAL-only
  commit is a valid base — the worktree shares the object store, so committing
  a precursor (e.g. a schema/migration half) on the feature branch in the main
  tree and dispatching against that SHA works without any push.
- **The inner worker's first action is `pwd` PLUS an assertion that the path
  contains `.claude/worktrees/`** — not a bare "confirm pwd".
- **Instruct the inner worker to end its turn with its report as its final
  text and make NO `SendMessage` attempt** — the orchestrator receives the
  Agent tool result directly.
- **Work the harness cannot do in a worktree stays with the main loop**:
  anything needing `.env` or the local dev DB (migrations, `db:*` commands)
  is done in the MAIN tree and committed as the base the worker self-heals
  onto.
- **NO commits, branches, or pushes** — the deliverable is a dirty worktree
  plus the report. This supersedes spec-template item 8 for nested dispatch:
  the harness's own `worktree-agent-*` branch already satisfies branch setup,
  and step 0's base verification takes item 8's place as the separate first
  step.
- **Expect a bare worktree**: no node_modules, no built dist. The prompt says
  to run `pnpm install` + `pnpm --filter "./packages/**" build` up front, and
  that "Failed to resolve entry for package @tzurot/…" means unbuilt dist,
  not a bad diff. Per-package `.bin` links arrive incomplete — the root-hoisted
  `node_modules/.bin/vitest` from the package dir is the fallback when
  `pnpm --filter <pkg> test` cannot resolve.
- **The dispatching turn states the expected wall time** from the measured
  range for the unit class — initial units ~20–45 min, review-round fixes
  ~5–20 min — so the owner has a "not stuck yet" horizon. A 45-minute dispatch
  with no horizon stated drew three "is it stuck?" check-ins in 90 minutes, and
  a plain range answers all three before they are asked.
- **Verification gates enumerated as exact commands** with the instruction to
  capture verbatim tails, run sequentially, and never run repo-wide heavy
  commands. Canaries (Core Principle 9) named in the spec get run and reported.

When the orchestrator reports, Fable's side is unchanged in substance from
§ When the worker reports, plus the transfer shape that keeps gates out of the
half-linked worktree: read the FULL diff in the worktree; then
`git -C <worktree> add -A && git -C <worktree> diff --cached > patch` — the
`add -A` first, because a plain `git diff` NEVER includes untracked files, so
a unit that created a file (a new module's colocated test is the routine case)
would transfer incomplete while every later check passed → confirm the main
tree's feature branch is still at the SHA the dispatch named as base (work
done in the main tree during the dispatch window moves the application
target silently) → `git apply` there → **verify the applied diff is byte-identical
to the patch AND that `git -C <worktree> status --porcelain` lists nothing
outside it** → verify the worktree has no unpushed commits, then
`git worktree remove --force` (sanctioned ONLY here, and resting on BOTH
preceding checks: the byte-identical diff covers everything uncommitted, and
the no-unpushed-commits check covers anything a worker committed against its
contract — either alone leaves a loss window) → run the touched packages' test suites and `pnpm quality` in the main tree (sequentially) → commit → PR →
monitor. The review gate is not delegated and not skipped for a clean-looking report.

## The spec template

Every implementation spec carries these sections, by name. A missing section is
a gap the worker will fill by guessing.

1. **Task** — the design decisions already made. The worker executes; it never
   designs. Include a ledger under the exact heading `## Premise ledger`:
   every premise the spec asserts about RUNTIME behavior carries a one-line
   cite of the read that established it, and the orchestrator is instructed to
   re-verify each by probe or test — not by re-reading the same code — before
   building on it. Two rows are mandatory in every
   ledger, because both failures are invisible from inside the spec: the grep
   for the FIX'S OWN NAME (is it already built?) and the grep for a PRIOR TASK
   ID or shipped PR that already covers it. `dispatch-spec-ledger-gate.sh`
   blocks a worktree dispatch carrying no such section — looking in the named
   spec file when the prompt names one, and in the PROMPT ITSELF when the
   instructions are inline, because writing a spec into the Agent call instead
   of a file does not make its premises any more checkable by the worker. It
   enforces the section's PRESENCE only; its quality is the orchestrator's
   re-verification, which no hook can see. The same gate also blocks two
   mechanical spec defects a worker discovers only by hitting them: a
   `pnpm --filter @tzurot/<pkg> <script>` the package does not declare, and a
   base SHA that resolves but is not the main checkout's HEAD.
2. **Files in scope** — mandatory, never omitted. Every `file:line` cite is
   marked "verify before editing — cites drift". State how the enumeration was
   derived (the exact grep) and its positive control (the known-present
   instance it matched), so the orchestrator can re-run and extend it. Name
   what the pattern cannot see: an identifier grep misses a STRUCTURAL copy of
   a type, so pair it with a distinctive field-name sweep.
3. **Budget headroom** — for every named file, its current ESLint-counted line
   total and headroom to 400 (`npx eslint <file> --rule '{"max-lines":["error",{"max":1,"skipBlankLines":true,"skipComments":true}]}'`
   — `wc -l` is not the metric, `02-code-standards.md`). Where headroom is
   smaller than the expected addition, name the extraction target as a
   PRE-AUTHORIZED routine decision rather than a stop; same for any touched
   function already at `max-lines-per-function`/`max-statements`/`max-params`.
4. **Landmines** — enumerated known traps: formatters that rewrite the file,
   gated baselines, hook behavior, fixture shapes. Say up front that the worker
   edits files with the Edit tool and never an interpreter heredoc rewrite
   script — `python-heredoc-edit-guard.sh` blocks those, and each block costs
   the worker a retry.
5. **Authorized routine decisions** — name the 2–3 calls the worker may make
   solo. Everything material not listed is a stop condition.
6. **Stop conditions** — the task-specific ones, on top of the agent contract's
   defaults.
7. **Verification gates — enumerate the exact commands, copied from the target
   package's `package.json` scripts** (or the direct `npx` equivalent when the
   script is absent — and say which): a missing script produces empty `pnpm`
   output indistinguishable from a silent pass. Name every gate CI will run
   for the touched packages; in particular BOTH `typecheck` AND
   `typecheck:spec` where the package defines it (separate tsconfig — plain
   `typecheck` misses test-file errors). Sequential, long timeouts, never in
   parallel (`05-tooling.md` § Resource Constraints).
   **Default the gate list to the touched packages' WHOLE-package commands**
   (`pnpm --filter <pkg> test`) plus every repo-level gate CI runs for them.
   A file-scoped test list is systematically narrower than CI. Name individual files only IN ADDITION, as a canary.
8. **Branch setup** — as a separate first step. The develop-code-commit-guard
   evaluates the current branch before compound commands run, so branch
   creation has to land on its own before any edit. For worktree spawns this
   step is preceded by the base-SHA verification WITH self-heal authorization
   (§ Worktree spawns › "The base IS stale by default") — never a bare
   verify-and-stop.
9. **Report requirements** — deviations flagged, verbatim verification tails,
   survivor-grep results. Git-state claims (current branch, base SHA,
   porcelain status) appear as pasted command output, never restated prose.
   The report also **declares the delegation shape**
   ("no inner worker — I judged the unit small enough" is a valid answer;
   silence is not) and carries **transfer notes**: tiers the worktree could
   not reach (`typecheck:spec`, `pnpm test:component` when a snapshot surface
   changed), gitignored artifacts the transfer must not sweep in, and whether
   the main tree's branch moved during the dispatch window.

## Worktree spawns

**Any worker that MUTATES files runs with `isolation: "worktree"` on the Agent
call — no exceptions but one: the INNER worker of a nested-dispatch pair runs
with no isolation flag, because its job is to edit the outer orchestrator's
already-isolated worktree, not a third tree (§ Nested dispatch).** A same-tree file-mutating worker and an orchestrator
that keeps using `git checkout` are fighting over one working tree: the
orchestrator's branch hop silently carries the worker's uncommitted edits onto
another branch. Same-tree spawns are for read-only analysis only — plus the sanctioned
nested-dispatch inner worker above, which is not a violation. Should the rule
nonetheless be violated and an UNsanctioned file-mutating worker found sharing
the tree,
the damage-control posture is: the orchestrator FREEZES its own git operations
(checkout, pull, rebase, merge) until the worker reports.

**Passing the flag is not proof it took effect — verify the tree immediately
after dispatch**, before the orchestrator does anything else with git:

```bash
git worktree list        # a NEW tree must be listed for the worker
```

(This checkpoint is for workers dispatched WITH the isolation flag — the
sanctioned nested-dispatch inner worker is expected to appear in no list of
its own, and its absence is not a freeze trigger.)

Only the main tree listed means the worker is in the SHARED tree despite
`isolation: "worktree"`. Why the flag can be ignored is **unknown and unprobed** — do not
record a cause. The response is the damage-control freeze above: no checkout,
pull, rebase, or merge until the worker reports. The weaker universal guard is
worth having too — re-read `git branch --show-current` immediately before any
commit, since a background agent can move it under you.

Before trusting any code-grounded output from a worktree-isolated worker,
verify the worktree's base against the intended SHA:

```bash
git -C <worktree-path> log -1 --format='%H %s'
```

A stale base is the failure mode that reads as competence: the worker behaves
correctly against the code it can see, and confidently "corrects" a spec that
was right about the code it cannot.

### The base IS stale by default — dispatch with a self-heal, not a stop

**The harness cuts agent worktrees from `main`, not from the orchestrator's
branch** (a worker dispatched from `develop` starts on the last release, missing everything merged since). The
`worktree-agent-*` branch shape is likewise observed harness behavior, not
repo-defined — if the harness ever changes it, the gate fails closed (the
worker stops instead of self-healing). With `worktree.baseRef: "head"` set in
tracked settings, agent worktrees branch from the current checkout's HEAD
instead, so the required base is usually already in place — but that HEAD is
read at SPAWN TIME, so the main checkout must be parked on the dispatch's
target branch before the Agent call, and a branch hop between units re-creates
the stale-base case the self-heal below still covers; the self-heal
below stays as the fail-closed backstop for a session whose settings are
overridden or stale. Treat the stale
base as the expected state and put the correction IN the dispatch prompt, as
the worker's step 0:

- Name the required base SHA **with its subject line**, so the worker's
  `git log -1` check is self-evidently right or wrong.
- **Authorize the self-heal**: if HEAD differs from the required SHA AND
  `git status -s` is empty AND the current branch is the agent's own
  `worktree-agent-*` branch AND `git log <required-sha>..HEAD --oneline` is
  empty (no commits would become unreachable — a clean tree says nothing
  about COMMITTED work, and this must hold even when the check is re-run out
  of order), the worker runs `git reset --hard <required-sha>` and
  re-verifies. The object store is shared with the main checkout, so no fetch
  is needed and the SHA is always reachable when it exists locally. This is
  the one sanctioned standing exception to `00-critical.md`'s ASK-FIRST
  `git reset --hard` entry, scoped to the agent's own throwaway
  worktree-agent branch under exactly these conditions.
- STOP remains the instruction when any condition fails: the tree is dirty,
  the branch is not a worktree-agent branch, commits exist past the required
  SHA, or the SHA is unreachable.

**A bare verify-and-STOP wastes the entire dispatch.** The harness AUTO-REMOVES
a worktree whose worker stops having changed nothing — so the correctly-stopped
worker cannot be resumed into it (its cwd is gone, and a resume then lands in
the shared tree, the exact state the isolation mandate exists to prevent).
Mid-run `SendMessage` steering loses the race too: the base check completes
before the message delivers. The self-heal authorization in the prompt is the
only correction that arrives in time.

### Resuming a worktree-isolated worker

**A `SendMessage` resume can silently drop the isolation** — the resumed run
can make every edit in the ORCHESTRATOR's tree while the tool result says only
"resumed from transcript", so this fails silently in the direction the worktree
mandate exists to prevent. A resume runs in the
BACKGROUND — `SendMessage` returns while the worker's turn is still executing —
so there is no checkpoint to gate on: the check below races the worker rather
than preceding it. Run it as soon as the resume returns, and until it comes
back clean, treat the resumed worker as same-tree and its diff as suspect,
which means the freeze posture above applies to the orchestrator's own git
operations:

```bash
git worktree list                 # the worker's worktree should still be listed
git branch --show-current         # the orchestrator tree must NOT be on the worker's branch
```

## While the worker runs

Pre-stage the next unit's grounding — read the files, profile the data, draft
the next spec. Never touch the worker's files while it holds them. Monitors
exist so waiting is never the activity (`10-working-posture.md` § Momentum).

**Board and tracker commits go to `develop` — check the branch first.** If the
main tree is parked on a feature branch while a dispatch runs,
`git switch develop`, commit, and switch back: a board commit made on a feature branch pushes as a silent "Everything up-to-date" no-op. Interaction with `05-tooling.md` § PR Monitoring: a branch hop moves
`$(git rev-parse HEAD)`, so arm any pending CI monitor — and see its SHA echo
— before hopping, not after. Backstopped by `board-commit-branch-gate.sh`.

## When the worker reports

**Read the FULL diff before any commit — the orchestrator's OWN read, never
delegated to a verifier subagent.** This gate is the reason the split works;
skipping it collapses orchestration back into a single context that reviewed
nothing, and delegating it re-collapses it from the other side (the judging
context must be the one that carries the spec's intent). Opus 5 in particular
delegates readily by documented tendency — Anthropic's own guidance: do not
use subagents to verify or double-check your own work. Then:

- A flagged stop or ambiguity is a good outcome, not a worker failure to work
  around. Resolve it and **resume the SAME worker** (`SendMessage` to its
  agent id) rather than spawning fresh — the resume retains the worker's full
  working context and rides the prompt cache, where a fresh spawn re-pays the
  entire spec and re-grounding. Spawn fresh only when the worker's own
  grounding is suspect (stale worktree base, confused state) — or when the
  worker's agent id did not survive a compaction boundary: ids cannot be
  enumerated afterward (same gap as Monitor ids, `CLAUDE.md` § Compaction
  Instructions), so a lost id means fresh-spawn is the only path. **A resume is
  not isolation-preserving** — re-verify per § Resuming a worktree-isolated
  worker before the resumed worker edits anything.
- Check every reported deviation against the spec's intent, not just its
  letter.
- **Verify, don't relay.** Re-run `git -C <worktree> log -1`,
  `status --porcelain`, and `diff --stat` for every git claim the report makes,
  and `git diff --stat -- <file>` for every "I added tests to X". A worker's "this canary cannot redden"
  is also a claim: build the discriminating fixture before accepting it.
- Re-run the gates yourself when the worker's verification tails are absent or
  truncated; a claim without command output is unverified.
- **Then sweep OUTWARD from the diff.** The leak shape is a claim or instruction on a surface the diff did not touch — a system-prompt constant still naming a field the new mode removed, an adjacent instruction string describing the old shape.
  Enumerate, by name, the prose and constants that DESCRIBE the behavior the
  unit changed but live outside its diff, and read each one. Neither the
  worker (out of its diff) nor the reviewer above (reading only the diff) is
  positioned to catch this — the orchestrator is.
- Then the normal commit → PR → monitor cycle per `/tzurot-git-workflow`.
- **Review-round hard cap (~6 rounds/PR)**: past it, stop iterating in this
  context — hand the open findings to a fresh-context implementer or the owner
  (`/tzurot-review-response` § 5a carries the procedure; the pointer is here because the failure has occurred in inline, non-delegated orchestrator work).

## Opus-main-loop posture

Four habits that matter more when Opus 5 drives the main loop than when it
works behind a spec.

- **Compact at unit boundaries, proactively.** Error quality degrades as the
  context window fills, and the degradation is invisible from inside it. Close
  the unit out to `CURRENT.md` / the tracker first, then compact — a boundary
  compaction loses nothing, while a mid-unit one loses the work-stack pointer.
- **Calibrate written-deliverable length.** Opus 5's disk deliverables (docs,
  backlog entries, PR bodies, CURRENT.md paragraphs) run longer than prior
  models' by documented tendency. Match length to what the task needs — cover
  the substance, no padded sections, no redundant summaries; the `lines:check`
  budgets are the backstop, not the target.

## Relationship to the rules

- **`.claude/agents/opus-implementer.md`** is the worker's own contract — the
  spec template above supplies what that contract expects to receive.
- **`00-critical.md`** § Merge Approval and § Never Merge PRs Without Completed
  CI govern the merge gate; the diff-read gate here sits before it, not instead
  of it.
- **`10-working-posture.md`** § Momentum and § Scope contract govern what the
  orchestrator does between dispatches.
- **`/tzurot-review-response`** owns what happens when the reviewer, rather
  than the orchestrator, finds the defect.
