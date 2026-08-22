---
id: TASK-718
title: Codify nested delegation as the standard operating model
status: Done
assignee: []
created_date: '2026-08-21 20:39'
updated_date: '2026-08-22 01:18'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 718000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner decision (2026-08-21) — if the TASK-667 nested-delegation pilot succeeds, tiered delegation (Fable main loop dispatches an Opus orchestrator agent that spawns Sonnet workers and returns an uncommitted diff; Fable reviews, commits, and owns the PR cycle) becomes the STANDARD operating model when Fable drives, replacing manual model-switching between sessions. Opus-driving sessions keep the existing /tzurot-orchestration posture unchanged.

What: update .claude/skills/tzurot-orchestration/SKILL.md mode-decision table with the nested posture for the Fable-driver row: dispatch shape (worktree isolation, base-SHA self-heal step 0, no-commit contract, five-gate verification, report requirements), the review gate staying with the Fable main loop, and the pilot evidence. Review-gated PR (skills are load-bearing).

Acceptance: the skill documents the nested posture with its dispatch template; the pilot outcome (defect rate at the Fable review gate, Fable-side token overhead) is recorded as the evidence basis; gated on pilot success — if the pilot fails, archive this task with the failure analysis instead.

DATA POINT 2, 2026-08-21 - TASK-708 PR 2 (PR 2175, merged). Nested dispatch (Opus orchestrator,
worktree, one Sonnet worker, no-commit contract): worker applied the spec verbatim and correctly;
orchestrator self-healed the stale base, ran all six gates, and CAUGHT AN ERROR IN THE FABLE-SIDE
DISPATCH SPEC (a wrong escaping expectation in a specced test) by reading the implementation -
corrected mid-flight and flagged honestly. Review round 1 found one real Medium in the shipped
diff (formatForwardedQuote's 'Unknown' coalesce entering the new comparison) - attribution:
Fable-side spec scoping AND the Fable diff review both missed it (neither swept the target
function's callers); not a worker-tier defect. Rounds 2-4 clean. Infra friction to codify in the
skill update: agent worktrees arrive without installed node_modules/dist (orchestrator burned time
on install+build; per-package .bin only partially links), so the working shape is: worker returns
the uncommitted diff, Fable transfers it to the main tree via git diff/apply (verify byte-identical),
runs gates there, commits. Two clean units now on the ledger; per the owner's gating (1-2 more after
the pilot), one more clean unit or an owner call promotes this to the skill edit this task specifies.

DATA POINT 3, 2026-08-21 - TASK-563 (PR 2176, merged f5ec6715c). Third consecutive clean nested
unit: worker applied the spec verbatim with zero corrections; orchestrator self-healed the base,
found the snapshot-regen mechanism, made one well-argued deviation (correlated ArbAttachment
generation, matching the real producer - ratified on review; the specced free boolean would have
generated unproducible payloads AND broken a second oracle the spec missed) and one necessary
scope extension (the oracle self-test), plus flagged a same-class sibling fixture the Fable review
then fixed (class swept). Review: zero blocking findings across the round.

EVIDENCE THRESHOLD REACHED: the owner's gating was pilot success across ~2-3 units; three clean
units are now on this ledger (TASK-667 / TASK-708 PR 2 / TASK-563), each with the orchestrator
improving on or honestly flagging against the dispatch spec, and all defects that reached review
attributable to Fable-side spec scoping, never the worker tier or the pattern. State flipped to
ready. The build is the skill edit this task specifies (review-gated PR on /tzurot-orchestration),
folding in the operational learnings recorded in data point 2 (worktree install/build friction,
diff-transfer-to-main-tree shape, byte-identical verification).

DATA POINT 4, 2026-08-21 - TASK-700 (PR 2177, merged; schema + sweep-logic two-commit shape). New
pattern variant proven: the Fable main loop did the SCHEMA half itself (migration needs the local
dev DB and .env, which agent worktrees lack) and committed it as the branch base; the nested Opus
orchestrator built the logic half against that local-only base SHA via the shared object store.
Orchestrator quality was the best yet: two unprompted canaries (backoff arm AND cap), a live PGLite
probe of the SQL null-semantics doc claim, a positive-controlled temporal-marker scan, and a
prettier fix with full gate re-runs. Review rounds: r1 found a REAL Medium test gap (the increment
branch of the failure-stamp CASE was untested - every test entered via ELSE; missed by the
orchestrator AND the Fable diff review; caught by the branch-walking reviewer), fixed with a
canaried test; r2-r4 clean, plus one reviewer false premise (a claimed duplicated fixture that
exists in only one file) refuted by grep. Four units on the ledger; codification remains the build.
<!-- SECTION:DESCRIPTION:END -->
