---
id: TASK-513
title: Revisit Opus 5 orchestrator trial after next release
status: To Do
assignee: []
created_date: '2026-08-10 23:03'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 513000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner directive (2026-08-10) — Fable weekly usage at 59% vs 43% all-models less than 48h after reset; need to shift load toward Opus 5 driving, but owner does not yet trust Opus 5 solo.
What: (1) review the orchestration skill + memory records for any tweaks needed before trialing Opus 5 as the MAIN-LOOP orchestrator of Sonnet workers (the role Fable plays today) — e.g. over-delegation tendency, escalation discipline, cite-the-read habit, compact-at-boundaries; (2) scope out a slate of work Opus 5 is LESS likely to get wrong for the trial (mechanical-class, spec-driven, low blast radius — not semantic design work).
Acceptance: a short written trial plan (tweak list + candidate work slate) presented to the owner before any Opus 5-driven session starts.
Promote when: the beta.199 release lands.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAL RUNNING — units 1-2 (started 2026-08-11, Opus 5 driving). Model verification note for step 1: the env-reported model string is STALE after a mid-session /model switch (it still said Fable 5 for the whole Opus stretch). The authoritative surface is the session JSONL's per-message `model` field: `grep -o '"model":"[^"]*"' ~/.claude/projects/<slug>/<session>.jsonl | uniq -c | tail`. Use that, not the env string.

Unit 1 — TASK-516 (PR #2060, ops logs snowflake argv). DEVIATION from step 4, deliberate: done INLINE, not delegated. Grounding showed the fix was ~4 lines against an existing helper (`rawOptionValue`), i.e. handful-of-tool-call work the skill's Opus posture says NOT to delegate; the plan named this unit before anyone had read the code. Orchestrator-diff-read findings: 1 real (my own new guard silently missed `--channel` — its UUID-exemption window bled into the NEXT option's `<uuid>`), caught pre-commit. Reviewer findings: 1 High that my class sweep AND my guard both missed — `retention:purge --exclude <ids>`, same coercion bug on the destructive command, invisible because I anchored detection on `-id` and "ids" does not end in "id". Verified, fixed, detector widened, canaried. Round 2: no blocking findings, reviewer independently re-verified both fixes. CI cycles: 3 (rounds 1-2 substantive, round 3 = autosquash + one nit doc line). Over-delegation events: 0. Escalations: 0 needed.

Unit 2 — TASK-515 (PR #2061, submit-path deploy-window retry). Delegated per plan: Sonnet worker, worktree-isolated, base SHA verified. Worker STOPPED correctly on the spec's named `max-lines` landmine (413/400) rather than improvising, with a clean canary and an honest deviation list — exactly the contract behaviour. Orchestrator decision at the stop: EXTRACT, not allowlist (the file held three copies of the retry loop). Resumed the SAME worker via SendMessage rather than respawning; it delivered the extraction green on all four gates. My own diff-read then caught 2 observability regressions the worker had honestly flagged (terminal error logs lost `attempt`; the delivery retry WARN lost `releaseId`) and fixed them via a context bag + returned attempt count. Worker semantic defects: 0 (append to TASK-487's ledger at merge). Over-delegation events: 0.

BOTH UNITS MERGED (#2060, #2061). CI cycles: 4 and 3. Escalations: 0 needed — no decision in either unit was genuinely the owner's, and the two that touched owner territory (dedup-window semantics, a rules edit) were FILED rather than made, per the hard boundaries: TASK-518 (state:owner), TASK-519, TASK-520. Boundaries held: no release ops, no schema, no rules edits, no taste calls.

Unit 3 — TASK-32 (PR #2062, guard:build-scripts). MERGED. Delegated to a Sonnet worker (worktree, base SHA verified — the harness created the worktree 18 commits behind develop, which the worker detected and reported rather than working around; rebased before push). Worker semantic defects: 0. Worker also correctly reported that the spec named two verification gates `@tzurot/tooling` does not define (`typecheck`, `typecheck:spec`) and substituted `tsc --noEmit` — an ORCHESTRATOR spec error, verified at source.
Orchestrator-diff-read findings: 1 real (the detector was allowlist-based and missed runner-prefixed `npx tsc`), fixed inline. CI cycles: 5. Reviewer findings across rounds: a Low false-negative gap (owner-approved widening to word-based detection), a deterministic-ordering nit, a stale-PR-body test count, a workspace-root scoping gap (→ doc-74), a Medium I INTRODUCED in my own round-1 widening (`./node_modules/.bin/tsc` invisible because I excluded `.` and `/` from the surrounding classes) and a non-string-`build` crash path. Final round: "No bugs found."
The instructive one: the reviewer's suggested fix for the Medium (`\btsc\b`) was WRONG — `-` and `:` are non-word chars, so it matches inside `tsc-helper` and `build:tsc` and would have broken two existing tests. Verified before applying and used a path-segment match instead. Also caught here: my first ordering test PASSED with the sort removed, because readdirSync happens to return alphabetical order on this filesystem — a test measuring nothing. Fixed by feeding the finder a deliberately reversed listing.

Unit 4 — TASK-24 (PR #2063, tracker relative-link gate). Delegated (Sonnet, worktree). Worker semantic defects: 0. Notable worker behaviour: it self-inflicted a near-loss (`git checkout --` on its own uncommitted implementation), caught it immediately, reconstructed and diff-verified against a backup, and switched to `cp`-based canary restores for the rest of the run — then reported the whole episode prominently unprompted. That honesty is the contract working.
Six CI cycles. The significant finding is round 4's High, and it is the sharpest self-criticism of the trial so far: the extractor only matched `./`/`../` targets, while CommonMark treats bare `foo.md` identically — and bare is the DOMINANT style in tracker/docs. 14 dead links were invisible to both the gate and to my "hand-resolved the full surface" verification, **because I derived that verification grep from the implementation's own assumption**. The check inherited the blind spot it existed to catch. Second instance of that exact shape in one session (the ordering test above is the first), which is the pattern worth carrying forward, not the individual misses.

Verdict read against the kill criteria, stated strictly because grading generously is the failure mode this record exists to prevent:
- "Two units where the reviewer catches a semantic defect the orchestrator diff-read missed" — the honest count is TWO reviewer catches of substance across two units: the unit-1 High (`retention --exclude`, same coercion class, missed because my sweep anchored on the `-id` NAME rather than on the coercion MECHANISM) and the unit-2 Medium (retry span outliving the gateway's 5s dedup window — a spec gap: I never told the worker the call was non-idempotent). By the letter, that is the threshold. By substance, neither was a WORKER defect and neither was a defect in code the diff-read examined — both were gaps in MY framing of the problem, one unit apart, and both were caught before merge by the layer designed to catch them.
- Over-delegation: 0 events. Unverified git-state claim accepted: 0 (worker base SHA verified before trusting its output).
- Separate, and the more useful signal: TWO comments I wrote asserted external-library runtime behavior as fact and were WRONG both times (cac's repeated-flag return, AbortSignal timeout implying delivery). Reviewer caught both, each citing this repo's own rules. Operationalized rather than resolved: a memory with the code-comment trigger, plus TASK-520 for the review-gated wording.

Recommendation to the owner (the decision is theirs, not the agent's): this reads as "keep, with the spec-writing gap named" rather than a clean pass or a kill. The orchestrator/worker split did its job — the worker was defect-free across a stop, a resume and an extraction, and every substantive miss traced to how the ORCHESTRATOR framed the unit, which is exactly what more units would exercise. Continue to units 3-5 on the remaining slate (TASK-32, 24, 178) before deciding, and treat "did the spec state the invariants the code actually has (idempotency, cost, blast radius)?" as an explicit spec-template question, since both misses were that same omission.

STATUS 2026-08-11: plan owner-approved; tweaks SHIPPED (PR #2059 merged — settled Sonnet tier citing the completed 11-unit TASK-487 ledger, never-delegate-the-diff-read, deliverable-length habit, defect-revert guardrail). The trial is STAGED and starts when the owner opens an Opus 5-driven session.

SESSION-START SEQUENCE for the Opus 5 driver (run in order, first turn):
1. State the env-reported driver model in the first reply (driver-model-check memory; silent downgrades happen).
2. Read THIS task's notes end to end — the boundaries and kill criteria below are binding.
3. Normal session start per 06-backlog (CURRENT.md → now.md → digest), then invoke /tzurot-orchestration BEFORE any src edit.
4. First unit: TASK-516 (safest slate item). Spec it per the skill template; worker = opus-implementer with model: sonnet, isolation: worktree.
5. The full-diff read is YOUR OWN read — never a verifier subagent. Do not delegate handful-of-tool-call work.
6. After each unit: append the outcome HERE (unit, orchestrator-diff-read findings vs reviewer findings, over-delegation events, escalation quality, CI cycles), then compact at the unit boundary.
7. Hard boundaries, no exceptions: no release operations, no schema/migrations, no .claude/rules edits, no owner-taste calls (escalate via AskUserQuestion, one named question + recommendation).

TRIAL PLAN (drafted 2026-08-11, research: Anthropic platform docs "Prompting Claude Opus 5" + "What's new in Claude Opus 5"; internal: orchestration skill, memory records, TASK-487 pilot).

External findings (official docs): Opus 5 (a) delegates to subagents MORE readily than prior models — mitigation is explicit delegation criteria + never delegating self-verification; (b) self-verifies unprompted — generic "double-check" instructions cause over-verification (audited our rules/skills: clean, only procedure-specific conditionals); (c) writes LONGER responses and disk deliverables — needs explicit length calibration; (d) can expand task scope (our 10-working-posture Scope contract already matches the doc wording); (e) is strong at code review/bug-finding with accuracy holding at LOWER effort — good fit for the orchestrator diff-read gate; (f) coordinates subagent teams well (writer-verifier patterns); (g) low/medium effort gives strong quality per token, xhigh for the hardest moments; (h) priced at half Fable, so driving on Opus shifts weekly load off the Fable cap.

Pre-trial tweaks (one review-gated .claude/skills PR, batching the two already-queued edits):
1. Orchestration skill: pilot→settled-tier wording for Sonnet workers (queued from TASK-487).
2. Orchestration skill: typecheck:spec named in every spec gate list (queued; missed twice — 2053, 2056).
3. Orchestration skill NEW: the full-diff read is the ORCHESTRATOR OWN read, never delegated to a verifier subagent (official guidance: do not use subagents to verify; delegating the gate would also collapse the fresh-context mechanism).
4. Orchestration skill NEW (Opus-main-loop section): deliverable-length calibration line — match written docs/backlog entries to what the task needs, no padded sections (docs run longer on Opus 5 by documented tendency).
No verification-wording removals needed (audit clean).

Session protocol for the trial (already codified, named here as watch items): driver-model check in first reply; effort high default with xhigh reserved for diff-read/design moments; compact at unit boundaries; escalation = one named question + recommendation via AskUserQuestion; verify worker git-state REPORT claims against the repo, not just the diff (the documented 2026-08-09 failure).

Trial boundaries: NO release operations, no schema/migrations, no .claude/rules edits, no owner-taste calls (escalate). Recording surface: per-unit outcomes appended HERE (TASK-487 pattern): unit, orchestrator-diff-read findings vs reviewer findings, over-delegation events, escalation quality, CI cycles.

Kill criteria (revert to Fable driving): two units where the reviewer catches a semantic defect the orchestrator diff-read missed; over-delegation persisting after one correction; any unverified git-state claim accepted. Success: 3-5 clean units → Opus 5 becomes the default drain-session driver, Fable reserved for design/release/semantic work.

Work slate (mechanical-class, spec-driven, bounded; ordered safest-first):
1. TASK-516 ops-logs snowflake string parse — tooling-only, zero prod path.
2. TASK-515 chat-submit-path retry — prod path but mirrors an in-file pattern, seam-testable.
3. TASK-32 clean-first build-script guard for new packages — tooling guard.
4. TASK-24 backlog-lint outbound theme-link resolution — tooling.
5. TASK-178 test:audit serviceDirs discovery (drop hardcoded list) — tooling.
6. TASK-139 + TASK-140 dockerfile-dist test hardening — tooling tests.
Excluded from trial: wording/UX-taste items (TASK-235/247/278), release ops, anything schema-touching.
<!-- SECTION:NOTES:END -->
