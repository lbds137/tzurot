---
name: tzurot-orchestration
description: 'Orchestrator mode: when to delegate implementation to a worker agent, the spec template every worker gets, and the full-diff review gate before any commit. Invoke with /tzurot-orchestration at the start of any implementation unit run in orchestrator mode — the moment a task fix shape is known, before the first src Edit/Write.'
lastUpdated: '2026-08-11'
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

| Driver                       | Posture                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fable main loop**          | Delegate implementation to `opus-implementer` by DEFAULT. "It's small" is not an inline justification. Inline only for: trivial mechanical edits (~a few lines), fixes discovered mid-review of a worker's diff, or work where writing the spec costs more than the edit.                 |
| **Opus main loop**           | Delegate substantive units — the fresh-context worker plus a separate diff review is the quality mechanism. But do NOT delegate work finishable in a handful of tool calls: Opus 5 over-delegates by documented tendency (prompting guide § controlling subagent spawning).               |
| **Bulk reading/exploration** | Explore/Plan agents, either driver. Reading fan-out is delegation's cheapest and least risky use. **Any read fan-out of ~4+ files, or any search across unknown locations, goes to `Explore` with `model: "haiku"` passed on the Agent call — never inline** (mechanism below the table). |

**Why Explore gets `model: "haiku"` per-call**: the built-in Explore inherits
the main-loop model (per the Agent tool's own schema: an omitted `model` "uses
the agent definition's model, or inherits from the parent" — inference from
that schema line, not a live probe), so an unpinned spawn bills the scarcest
budget, while every file read inline re-bills as main-loop input on all later
turns.
Per-call `model` is the verified mechanism; a frontmatter override file was
ruled out — TASK-438's probes showed the harness ignores subagent
TOOL-restriction frontmatter (`tools:`/`disallowedTools:`), so an override's
read-only surface would rest on unenforced fields, and whether a project file
can override a built-in agent name at all was never probed.

**Worker model tier (settled)**: for a **mechanical-class** unit — one whose
spec describes the edit precisely (renames, sweeps, fixture updates, applying
a settled pattern across files) — the orchestrator passes `model: sonnet` on
the Agent call instead of the default Opus model (same `opus-implementer`
contract, only the model overridden per-call); an edit that can be described
precisely does not need Opus-tier judgment to execute, and the spec template
produces exactly that. Sonnet is the STANDING tier for mechanical-class units
— settled by the TASK-487 record (11 units, 0 worker semantic defects; every
review round attributable to reviewer polish or orchestrator-side scoping,
never the worker tier). Semantic-class units (design judgment inside the
diff) stay on Opus. If a Sonnet unit ships a semantic defect: append it to
TASK-487's notes (that file is the tier's standing evidence ledger; its Done
status does not bar appends, and appends are file edits only — the CLI's
`--notes` flag REPLACES the whole section and has destroyed notes before)
AND drop mechanical-class delegation back to Opus for subsequent units.
Resume Sonnet only when the recorded analysis attributes the defect to
spec/scope rather than the worker tier, or the owner calls it.

## The spec template

Every implementation spec carries these sections, by name. A missing section is
a gap the worker will fill by guessing.

1. **Task** — the design decisions already made. The worker executes; it never
   designs.
2. **Files in scope.**
3. **Landmines** — enumerated known traps: formatters that rewrite the file,
   gated baselines, hook behavior, fixture shapes.
4. **Authorized routine decisions** — name the 2–3 calls the worker may make
   solo. Everything material not listed is a stop condition.
5. **Stop conditions** — the task-specific ones, on top of the agent contract's
   defaults.
6. **Verification gates — enumerate the exact commands.** Name every gate CI
   will run for the touched packages; in particular BOTH `typecheck` AND
   `typecheck:spec` where the package defines it (separate tsconfig — plain
   `typecheck` misses test-file errors). Sequential, long timeouts, never in
   parallel (`05-tooling.md` § Resource Constraints).
7. **Branch setup** — as a separate first step. The develop-code-commit-guard
   evaluates the current branch before compound commands run, so branch
   creation has to land on its own before any edit.
8. **Report requirements** — deviations flagged, verbatim verification tails,
   survivor-grep results.

## Worktree spawns

**Any worker that MUTATES files runs with `isolation: "worktree"` on the Agent
call — no exceptions.** A same-tree file-mutating worker and an orchestrator
that keeps using `git checkout` are fighting over one working tree: the
orchestrator's branch hop silently carries the worker's uncommitted edits onto
another branch (observed live — the first Sonnet-pilot unit had its branch
yanked mid-edit). Same-tree spawns are for read-only analysis only. Should the
rule nonetheless be violated and a file-mutating worker found sharing the tree,
the damage-control posture is: the orchestrator FREEZES its own git operations
(checkout, pull, rebase, merge) until the worker reports.

Before trusting any code-grounded output from a worktree-isolated worker,
verify the worktree's base against the intended SHA:

```bash
git -C <worktree-path> log -1 --format='%H %s'
```

A stale base is the failure mode that reads as competence: the worker behaves
correctly against the code it can see, and confidently "corrects" a spec that
was right about the code it cannot.

### Resuming a worktree-isolated worker

**A `SendMessage` resume can silently drop the isolation.** Observed: a worker
spawned with `isolation: "worktree"` (worktree confirmed — it reported a base
SHA 26 commits stale and stopped on it) was resumed via `SendMessage`; the
resumed run created its branch and made every edit in the ORCHESTRATOR's tree,
and `.claude/worktrees/` was empty at completion. The tool result says
"resumed from transcript" and nothing about isolation, so this fails silently
in the direction the worktree mandate exists to prevent. A resume runs in the
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
- Re-run the gates yourself when the worker's verification tails are absent or
  truncated; a claim without command output is unverified.
- Then the normal commit → PR → monitor cycle per `/tzurot-git-workflow`.

## Opus-main-loop posture

Four habits that matter more when Opus 5 drives the main loop than when it
works behind a spec.

- **Compact at unit boundaries, proactively.** Error quality degrades as the
  context window fills, and the degradation is invisible from inside it. Close
  the unit out to `CURRENT.md` / the tracker first, then compact — a boundary
  compaction loses nothing, while a mid-unit one loses the work-stack pointer.
- **Escalate as one named question plus a recommendation**
  (`09-interaction-style.md`). A menu without a pick is not an escalation; it
  moves the decision to the user without the analysis that would let them make
  it cheaply.
- **Cite the read that proved it.** Before stating any factual claim about the
  code, name the tool result from THIS session that establishes it
  (`00-critical.md` § Don't Present Speculation as Fact). When challenged on a
  claim, re-verify at the source rather than defending it — the pull to defend
  is strongest exactly when the claim came from memory rather than a read.
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
