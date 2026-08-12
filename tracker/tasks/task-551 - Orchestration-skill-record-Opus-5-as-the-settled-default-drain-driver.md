---
id: TASK-551
title: 'Orchestration skill: record Opus 5 as the settled default drain driver'
status: Done
assignee: []
created_date: '2026-08-12 12:01'
updated_date: '2026-08-12 12:44'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 551000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-513 closed 2026-08-12 with the owner verdict that Opus 5 is the DEFAULT drain-session driver (Fable reserved for design/semantic/taste work), but the orchestration skill still frames Opus-main-loop as one posture among several in its mode-decision table. A settled default that lives only in a Done task file and machine-local memory is invisible to any other contributor and to a fresh session that does not grep for it.

What: update .claude/skills/tzurot-orchestration/SKILL.md mode-decision table to state the default explicitly, and record that release operations are no longer model-scoped (they rest on the per-release owner-approval gate, which is model-independent). Schema/migrations and owner-taste calls still escalate.

Why not now: .claude/skills is review-gated, so it needs a PR. Ride it with TASK-542 and TASK-547, which are also orchestration/skills edits.

Acceptance: the skill states the default driver without needing TASK-513 read alongside it.
<!-- SECTION:DESCRIPTION:END -->
