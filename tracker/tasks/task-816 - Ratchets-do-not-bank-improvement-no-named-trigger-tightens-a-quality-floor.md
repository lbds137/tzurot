---
id: TASK-816
title: 'Ratchets do not bank improvement: no named trigger tightens a quality floor'
status: To Do
assignee: []
created_date: '2026-08-29 14:22'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 816000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner observation on the 2026-08-29 Saturday audit — "if we are doing better than the floor, we should slide the floor up to match where we are. isn't that how ratchets work? I feel like this needs proper operationalization", refined to "some values are probably okay as they are now, like the current markdown file, but stuff like mutation tests should be improving over time not staying static".

THE DISTINCTION THAT MAKES THIS TRACTABLE (and which the refinement above is exactly right about): the audit reports two different KINDS of number under one "ratchet margins" heading, and only one of them should bank improvement.

- BUDGETS (lines/bytes for the .claude/rules total and CURRENT.md, cpd filteredLines, raw-content allowlist count). Lower is better, and the slack is HEADROOM you are permitted to spend. Being under a budget is not an achievement to lock in — tightening on every dip would make ordinary authoring fight the gate. These are mostly fine as-is, and some already bank: lines:update-baseline ratchets a trimmed surface DOWN, and the raw-content allowlist is documented shrink-only with an exact-count staleness test that banks every reduction.
- QUALITY FLOORS (mutation score per tracked package; arguably coverage). Higher is better, and slack above the floor is achievement that should be locked in so it cannot silently regress. This is the class the owner means, and it is the class that never tightens.

WHY MUTATION NEVER TIGHTENS, concretely (verify before building): the only sanctioned refresh is pnpm ops mutation:update-baseline, which per 05-tooling.md requires a fresh LOCAL report for EVERY tracked package. Services were measured non-viable per-PR (30-70min). CI does not produce a fresh score either — mutation:gate sets run=false when the diff cannot move a tracked score, fail-open. So the baseline only ever moves when a human runs the whole tracked set by hand, which is exactly the "tool with no named decision-point trigger" failure 00-critical warns about. The five tracked baselines currently sit at config-resolver 86.89, cache-invalidation 89.44, conversation-history 86.34, identity 78.83, clients 96.44, each with a 1.0 graceMargin floor.

THE TRAP, and why "slide the floor to the last observed score" is the wrong build: mutation scores are not deterministic. Stryker has per-mutant timeouts, so a loaded machine kills a different mutant set than an idle one. The 1.0 graceMargin exists for that noise. A baseline slammed to one lucky run makes CI fail on the next ordinary run — converting a quality gate into a flake, which is how gates get disabled. Any tightening must have hysteresis.

Fix shape (design, not settled): (a) classify every registered ratchet as BUDGET or QUALITY FLOOR, and record the classification where the ratchet is defined, so the question is answered once per ratchet rather than per audit; (b) give the quality-floor class a NAMED trigger — the release preflight and/or the Saturday audit are the two existing recurring moments — at which the tracked set is actually measured; (c) tighten with hysteresis rather than to the last value: raise the baseline only when observed minus graceMargin exceeds the current baseline across N consecutive measurements, or take the MINIMUM of the last N runs rather than the latest; (d) cheapest high-value piece, worth doing even if the rest is deferred: make the audit report UNBANKED IMPROVEMENT explicitly. Today it prints "baseline only - no live run", which hides whether we are at the floor or well above it, so the slack is invisible and nobody knows there is anything to bank.

Acceptance: each registered ratchet carries a BUDGET/QUALITY-FLOOR classification; the quality-floor class has a named recurring trigger at which tightening is considered, recorded in the rule or skill that owns that moment; tightening uses hysteresis and the reason is documented at the mechanism; and the audit distinguishes "at the floor" from "above the floor by N" instead of reporting the baseline alone. Deliberately NOT in scope: making mutation run per-PR (measured non-viable, do not re-attempt without new data).
<!-- SECTION:DESCRIPTION:END -->
