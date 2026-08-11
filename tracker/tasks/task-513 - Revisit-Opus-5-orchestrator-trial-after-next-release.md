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

Running read on the trial: the orchestrator diff-read is catching real defects (unit 1's guard hole, unit 2's log regressions), and the reviewer is still catching things the diff-read misses — the unit-1 High is the honest mark against this stretch, and its root cause was a sweep anchored on a naming pattern rather than on the coercion mechanism.

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
