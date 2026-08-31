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

MEASURED 2026-08-30 — read this before designing anything, it moves two premises.

All five tracked packages were run locally, one at a time, on an otherwise idle machine. Per-package wall clock and score vs. the committed baseline:

  package              measured  baseline  delta    seconds
  identity                78.97     78.83  +0.14        147
  config-resolver         86.89     86.89   0.00         85
  cache-invalidation      89.44     89.44   0.00         58
  conversation-history    85.64     86.34  -0.70         89
  clients                 96.44     96.44   0.00         47

PREMISE 1 MOVED — cost. The whole tracked set runs in 426 seconds, about 7 minutes. The 30-70min non-viability figure in this task is about SERVICES and does not transfer to these five. Cost is therefore not what blocks a recurring trigger, and clause (b) can pick a moment freely; the Saturday audit already runs weekly and 7 minutes fits inside it.

PREMISE 2 MOVED, AND THIS IS THE IMPORTANT ONE — there is no improvement to bank. Three of five sit EXACTLY at baseline (delta 0.00), which means the baseline was written from these same runs and nothing has moved since. identity is +0.14, which is inside the noise the 1.0 graceMargin exists to absorb. So the owner framing this task was filed on — "if we are doing better than the floor, slide the floor up" — does not describe the current state of the mutation ratchet. We are AT the floor, not above it.

conversation-history is the sharp one: -0.70, i.e. it has DECAYED below its baseline. It stays green only because 85.64 is still above the 85.34 floor. That is the graceMargin doing exactly its job, and it is also a direct argument against the naive version of clause (c): a baseline tightened to last-observed at any earlier point would have this package failing CI today for ordinary drift.

WHAT THIS MEANS FOR THE DESIGN. Clause (d) as filed — "report unbanked improvement" — would, on today's data, report approximately zero on every package. That is still worth building (a number that reads 0.00 is informative and would have prevented this task being filed on the wrong premise), but it is not the high-value piece the task calls it. The live question becomes whether these floors should be RAISED DELIBERATELY as a quality target — a decision about how much test rigor we want to buy — rather than ratcheted opportunistically as slack appears. That is an owner call about investment, not an engineering call about mechanism, and it should be put to the owner before clauses (a)-(c) are built against the banking premise.

CAVEAT ON THESE NUMBERS: one run per package. Stryker is nondeterministic (per-mutant timeouts make a loaded machine kill a different mutant set), so a single run cannot distinguish a real -0.70 decay from an unlucky sample. Re-run conversation-history before treating its decay as real.

⚖️ OWNER DECISION 2026-08-30 — BINDING, do not re-litigate. Presented with the measurement above and three options (visibility-only / raise the floors deliberately / close the task), the owner chose RAISE THE FLOORS DELIBERATELY. Mutation score is a RISING QUALITY TARGET for the tracked set, not merely a regression guard. The agent recommendation was visibility-only; the owner overruled it, so a future session must not re-propose the cheaper option as though the decision were open.

WHAT THAT DECISION DOES AND DOES NOT SETTLE. It settles the PURPOSE (floors go up over time, and closing the gap is real scheduled work rather than an opportunistic tighten). It does NOT settle the MECHANISM, and the mechanism still has to respect the trap documented above: floors must NOT be slammed to the last observed score. Two facts from the measurement constrain any design — three packages sit exactly AT baseline (so "raise to current" is a no-op for them), and conversation-history measured 0.70 BELOW its baseline (so "raise to current" would LOWER it, and a naive last-observed ratchet applied earlier would have it failing CI today).

CONSEQUENCE: raising a floor now means WRITING TESTS FIRST, then moving the number — the floor follows the work, it does not lead it. That reverses the task's original framing, which assumed slack already existed to be captured.

SEQUENCING (proposed, not owner-settled): (1) re-run conversation-history alone (~89s) to decide whether its -0.70 is real decay or single-run noise, since a real decay means that package needs test work before any floor moves at all; (2) pick per-package target floors with the owner, since "how much rigor to buy" is the same investment call this decision was; (3) close gaps to hit them; (4) move the baselines via the sanctioned pnpm ops mutation:update-baseline path, never by hand. Clause (d) from the original filing (report distance-above-floor) is still worth building — under this decision it becomes the progress meter for the campaign rather than a way to spot free tightens.

RELATED: doc-63 "Ratchet Bidirectionality (audit mini-epic)" in backlog/cold/queue.md already owns exactly this scope — audit each ratchet's slack, apply free tightens, give down-tightening an owner-moment. This task is a member of that theme, not a standalone; check doc-63 before scoping, and consider whether the finding above changes the theme's premise too.

TRANCHE 1 TEST WORK COMPLETE 2026-08-31 — sequencing steps (1) and (3) done, step (2)/(4) pending owner. Four test-only PRs merged same-day, each with full survivor disposition (every kill proven-red via the mutation report's Survived→Killed flip; every non-kill is logger-name noise per the ignorer rationale or a PROBED equivalent):

  package              old ->  new    PR     residue
  conversation-history 85.64  97.39  #2271   8 noise + 8 equivalent
  clients              96.44  98.42  #2272   4 equivalent (HARD CEILING without src changes)
  cache-invalidation   89.44  97.53  #2273  11 noise, 0 equivalent
  config-resolver      86.89  96.54  #2274   5 noise + 14 equivalent
  identity             78.83  78.97  (untouched — outside tranche 1; 192 survivors remain)

The conversation-history -0.70 decay was REAL (re-run reproduced 85.64 exactly; forwardedOriginWriter.ts was at 20% mutation score — a post-baseline file with weak tests, now 90%).

RAISE-STEP INPUTS (step 2, owner): fresh local reports exist for ALL FIVE packages as of 2026-08-31 (identity re-run reproduced 78.97 exactly), so `pnpm ops mutation:update-baseline` is executable immediately. Recommendation on record: refresh all five baselines to the measured scores (graceMargin 1.0 continues to absorb run noise — scores reproduced exactly across 2-3 runs each on this machine, so measured-score floors are not lucky-run floors). Constraint: clients at 98.42 is the arithmetic ceiling; a floor demanding more requires deleting two semantically-redundant early-returns (src change, deliberately excluded from the tests-only tranche). identity's gap-closing (192 survivors, 78.97) is tranche 2 if wanted — NOT part of this raise.

Review residue: TASK-843 (subscribe registers callback before try — latent stale-callback defect found by the #2273 review, src fix, size:S).

TRANCHE 2 PROFILE (identity) — measured from reports/mutation/identity/mutation.json, the run that reproduced 78.97. Recorded so the slicing is not re-derived; re-run before building, the file is a local artifact.

  survivors by file          by mutator
    63 UserService.ts          63 ConditionalExpression
    47 PersonalityLoader.ts    32 StringLiteral
    29 PersonaResolver.ts      21 BlockStatement
    15 PersonalityService.ts   17 ObjectLiteral
    14 PersonalityValidator.ts 15 LogicalOperator
    12 BaseConfigResolver.ts   13 BooleanLiteral
    11 PersonalityDefaults.ts  10 EqualityOperator
     1 RoutingContextResolver  (+ 14 across 7 minor mutators)

  totals: 179 Survived + 13 NoCoverage = 192; 720 Killed, 1 Timeout.

TWO THINGS THIS CHANGES ABOUT SCOPING. (1) The top three files hold 139 of 192 (72 percent), so the natural slicing is one PR per file for those three plus one PR for the remaining five, NOT a single tranche-2 PR. (2) Only 32 survivors are StringLiteral, and that is the class that was almost entirely logger-name noise in tranche 1 — here roughly 160 are behavioral (conditionals, blocks, object literals, logical and equality operators), so this is real untested logic rather than a noise tail. Expect tranche 1 effort per FILE, not per package.

Consequence for the floor raise: identity cannot reach a tranche-1-like score in one unit. Either raise its floor in steps as each file lands, or hold the identity raise until the whole tranche completes. That is an owner call at raise time, not settled here.

TRANCHE 2 SLICE LOG.

  slice                 file score      package    PR     residue
  1 UserService.ts      72.49 -> 89.96  78.97 -> 83.35  #2282  6 noise, 8 equivalent, 2 need src
  2 PersonalityLoader.ts  (47 survivors)   —            —      —
  3 PersonaResolver.ts    (29 survivors)   —            —      —
  4 the remaining five    (53 survivors)   —            —      —

Slice 1 notes worth carrying into 2-4. Two mutants are dispositioned NEEDS A SOURCE CHANGE and stayed unkilled deliberately: USER_CACHE_TTL_MS arithmetic and the TTLCache options literal. TTLCache accepts a `now` override built for exactly this kind of test, but UserService never threads one through its constructor call, so verifying the real TTL would need an hour wait or private-field access. If later slices accumulate more of these, a small injection-seam PR is the honest way to close them — as one deliberate source change with its own review, never smuggled into a tests-only slice.

PRECEDENT SET IN SLICE 1, and deliberately narrow: one test calls a private method. Allowed ONLY where the source itself documents the branch as defense-in-depth for a future caller — which isPrismaUniqueConstraintError's `target` parameter does, its element-equality property existing so a future caller passing a short target cannot silently false-positive. The reviewer independently endorsed the line as narrowly scoped. It is NOT permission to reach past the public surface because a number is hard to move; slices 2-4 hold the same bar.
<!-- SECTION:DESCRIPTION:END -->
