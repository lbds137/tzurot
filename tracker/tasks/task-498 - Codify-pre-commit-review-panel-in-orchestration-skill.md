---
id: TASK-498
title: Codify pre-commit review panel in orchestration skill
status: To Do
assignee: []
created_date: '2026-08-09 23:22'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 498000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2032 took 9 CI review rounds at ~5min+ each; most rounds 5-9 findings (silent field drops, ceiling parity, wording nits) were catchable by a local diff read before commit. A 3-agent pre-commit panel (correctness/seams lens, project-rules lens, wording/docs lens) converts CI cycles into cheap local reads.
What: after the PR 3 trial run, add a "pre-commit review panel" step to .claude/skills/tzurot-orchestration/SKILL.md (between "When the worker reports" full-diff read and the commit) with the three lens prompts and the decision rule for when to run it (multi-round-risk PRs, not trivial mechanical units). Also note the parallel-independent-units option with its Steam Deck OOM serialization caveat. Skill edits are review-gated: land via PR.
Acceptance: skill section merged; panel trial results (findings caught vs. later CI rounds on PR 3) recorded in this task before closing.
<!-- SECTION:DESCRIPTION:END -->
