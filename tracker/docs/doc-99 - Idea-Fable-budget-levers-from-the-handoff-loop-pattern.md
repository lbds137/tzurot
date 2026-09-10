---
id: doc-99
title: 'Idea: Fable-budget levers from the handoff-loop pattern'
type: other
created_date: '2026-09-09 19:45'
---


## Idea: Fable-budget levers from the handoff-loop pattern

Source: an owner-shared community thread (2026-09-09) describing two setups for keeping Fable usage down. Most of both is already our division of labor in stricter form (spec template with premise ledger and canaries, Explore on haiku, orchestrator gate runs, claude-review). Three items are not, and each targets one of the two remaining cost terms per unit: main-loop tool-call COUNT and CONTEXT LENGTH (every call re-reads the whole context).

1. Mechanize the worktree transfer and the close-out. The transfer procedure in the orchestration skill is ~10 to 15 main-loop calls per unit (add -A, cached diff, apply --check, apply, byte-compare, porcelain-vs-patch, no-unpushed-commits, unlock, remove --force, prune, branch -D, then suites, quality, commit, PR, monitor). One ops command, e.g. pnpm ops worktree:transfer <path>, that runs the checks in order, refuses on any failure with the reason, and prints a one-screen verdict collapses that to one or two calls. Same shape for the unit close-out (task Done, board line, CURRENT.md record, commit, push). Highest expected saving; pure tooling; the safety checks are already specified in the skill so the command is a transcription.

2. A cold refuter before push, verdict-only into the main loop. Today the main loop reads the FULL diff as the gate. The main loop also wrote the spec, so it re-verifies the diff against its own premises, which is the same blind spot the skill names for workers, and the mining shows defects are spec-origin not worker-origin. A fresh Opus reviewer handed the diff, the task acceptance line and the ledger, but NOT the spec, catches spec-origin defects the way claude-review does, only before the CI round. The main loop then reads a short verdict plus a diffstat instead of the diff. Judge it by rounds per PR (currently ~1.5 to 3.4 across the 09-03 to 09-09 windows). Risk: a third model layer per unit; if it does not move rounds per PR it is pure cost.

3. Cap what returns into the main-loop context. Orchestrator reports carry verbatim gate tails. Full report to a scratch file, final text under ~40 lines with the verdict and the claim/canary table; the main loop reads the file only on a non-clean verdict. Compounds because context length drives the per-call cost on every later turn.

First step, before building any of the three: a usage-audit measurement (the /tzurot-usage-audit skill) of main-loop calls per unit PHASE (spec, dispatch wait, diff read, transfer, gates, PR, review rounds, close-out) over the last two Fable windows, so the build targets whichever phase dominates.

**Measurement taken 2026-09-10** (two Fable windows, 2026-09-09 evening and 2026-09-10 evening UTC; 125 main-loop tool calls, 6.2M weighted tokens; full report machine-local, aggregates here). Combined, by calls: other 23% (the 09-09 window was session-mining and cut work), spec 20%, PR 14%, review rounds 12%, close-out 10%, transfer 10%, dispatch 5%, gates 4%, diff read 1%. In the orchestrated window alone (09-10: three dispatches and one main-cut PR), PR + review rounds + transfer + close-out are 72.6% of calls and 48.3% of weighted spend; dispatch calls are 8.1% / 10.4%; spec is 19.4% / 15.9%. Main-loop cache-read share was 67.5% in both windows, below the ~85% the posture rule quotes, because these windows are many short git/gh/tracker calls rather than long reasoning turns. **Reading: lever 1 dominates.** The transfer + close-out + PR bookkeeping is the phase to mechanize; filed as TASK-934. Levers 2 and 3 were not measured by this pass (rounds per PR and context length are different instruments) and stay open here. Not taken from the thread: the researcher role (the orchestrator grounding step covers it), the shared-hand rework loop (SendMessage resume already preferred, TASK-922 the known hazard), seats (one unit at a time on this machine), and short replies (owner taste already settled).
