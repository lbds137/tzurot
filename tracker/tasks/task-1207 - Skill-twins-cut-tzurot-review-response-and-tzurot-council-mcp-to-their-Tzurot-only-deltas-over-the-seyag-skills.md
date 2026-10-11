---
id: TASK-1207
title: >-
  Skill twins: cut tzurot-review-response and tzurot-council-mcp to their
  Tzurot-only deltas over the seyag skills
status: To Do
assignee: []
created_date: '2026-10-11 11:08'
labels:
  - 'area:repo'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1196000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Tzurot ships project copies of skills the seyag plugin now carries machine-wide. Measured 2026-10-11 (sorted unique non-empty lines shared verbatim with the seyag twin): tzurot-review-response 133 of 206, tzurot-council-mcp 133 of 143. Both copies load into context and drift independently: the GLM-week mining (2026-10-11) proposed review-response fixes against the seyag skill, which a Tzurot session never reads while the project copy wins. The other twins measured low verbatim overlap (bug-remediation 6/79, reuse-scout 2/55, session-mining 5/280, usage-audit 5/168: seyag rewrote them generically), so they need a section-by-section read, not a dedup; TASK-1105 already covers usage-audit Step 2.

What: the TASK-1111 pattern. For each of the two skills, keep only Tzurot-specific material (ops commands, rule pointers, owner rulings recorded in the skill) and replace each shared section with a one-line pointer to the seyag skill heading; anything Tzurot added that is generic goes upstream to seyag via Deck first. Then the same read for the four reworded twins, recording keep/point/upstream per section in the PR body. Ratchet lines:check skills baseline down.

Acceptance: no procedure text appears in both copies; every pointer names a heading that exists in the seyag skill (grep it, or TASK-1110 guard once built); lines:check green with the skills baseline lowered.
<!-- SECTION:DESCRIPTION:END -->
