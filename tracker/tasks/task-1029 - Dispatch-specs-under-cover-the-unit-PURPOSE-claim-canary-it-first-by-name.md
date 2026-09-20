---
id: TASK-1029
title: 'Dispatch specs under-cover the unit PURPOSE claim; canary it first, by name'
status: To Do
assignee: []
created_date: '2026-09-20 22:36'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1023000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: four defects of ONE shape were caught downstream in a single day (2026-09-20, PRs #2458 and #2459), all in specs written by the main loop. The shape is not carelessness about lists — every list was individually correct. It is that a correct enumeration was never checked against the one sentence saying why the unit exists.

The four, with what each cost:
1. PR #2458 premise ledger named `MessageFormatter.ts` as one of four `<embed>` wrapper sites. It is a CALLER, not a wrapper — it emits no tags. A guard placed there could not have suppressed a wrapper it does not emit, structurally the same mistake the task warned about for `parseEmbed`. Caught by the dispatch orchestrator before code was written against it.
2. PR #2459 as first specced had steps 1, 3 and 4 in one unit, where step 4 made `type` and `url` renderable and both other steps keyed on `parseEmbed` returning empty. The diagnostic could therefore never have fired on the incident that motivated it. Caught by the orchestrator, runtime-confirmed with a probe.
3. Asking the orchestrator to verify a body-half fix by re-running one canary that tests the MARKER half. Re-running it would have reported success about a property never tested. The orchestrator noticed and invented the canary that discriminates.
4. PR #2459 shipped nine canaries derived from the claim set, and the claim set never contained the units central claim — that a live `Message` reaches the diagnostic. The capture path, the entire reason the PR exists, was unpinned until claude-review found it.

Root cause common to all four: canaries are derived from the claim set, so an under-enumerated claim set silently yields under-coverage, and nothing in the current procedure re-checks the claim set against the units purpose. `/tzurot-orchestration` already says canaries are DERIVED from the claim set rather than chosen by taste, and that rule was followed each time. The gap is one level up.

Fix shape: add one step to the spec template in `.claude/skills/tzurot-orchestration/SKILL.md`, in the Verification gates section beside the existing canary rule. The spec must state the units PURPOSE in one sentence under its own heading, and name the canary that falsifies THAT sentence FIRST, before the canaries derived from the broader claim set. Mechanically: if the unit exists to make X happen, the first canary breaks X and must redden. An orchestrator receiving a spec whose purpose canary is missing should treat it as a spec defect and say so rather than proceeding.

Why a skill edit rather than a rule: this is procedural, fires only when a spec is being written, and `07-documentation.md` puts procedures in skills. Note the file is review-gated per `00-critical.md`, so it needs a PR, not a direct develop commit.

Worth considering while there, but do NOT let it block the one-line fix: whether `dispatch-spec-ledger-gate.sh` can check for the presence of a purpose heading the way it already checks for the premise ledger. Presence is checkable; whether the named canary actually falsifies the purpose is not, same limit the ledger gate already has.

Acceptance: the spec template names a purpose sentence plus a purpose canary as a required section; the instruction to orchestrators to reject a spec missing it is explicit; the next dispatched unit after the change carries both and its report shows the purpose canary reddening.
<!-- SECTION:DESCRIPTION:END -->
