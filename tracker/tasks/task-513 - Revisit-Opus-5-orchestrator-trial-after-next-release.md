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
