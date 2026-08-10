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
