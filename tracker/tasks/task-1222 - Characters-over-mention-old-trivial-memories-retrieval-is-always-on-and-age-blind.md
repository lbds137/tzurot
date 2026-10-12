---
id: TASK-1222
title: >-
  Characters over-mention old trivial memories: retrieval is always-on and
  age-blind
status: To Do
assignee: []
created_date: '2026-10-12 22:26'
labels:
  - 'area:memory'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 1211000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod user report (Discord, 2026-10-12): the bot brings up the same old memory (a dinner from two months ago) in nearly every reply, treating trivia as a milestone. The only remedies today are user dials: raise Memory Relevance (memoryScoreThreshold, default 0.5), lower Memory Limit (memoryLimit, default 20, 0 = off), or delete the row via /memory.

Mechanism (code-read, not runtime-confirmed): every turn injects up to 20 episodes ranked on similarity alone (services/ai-worker/src/services/MemoryRetriever.ts:315-339; no age or importance term in PgvectorQueryBuilder.ts). The prompt already frames them as background (MemoryFormatter.ts:52, usage=context_only_do_not_repeat) and the model mentions them anyway.

Prior decision to respect: doc-8 1b composite scoring (recency/salience terms) was REFUTED on recall@10 goldens in July. That eval measures whether the right memories are FOUND, not whether surfaced trivia gets over-mentioned. This complaint is a different metric (unprompted-mention rate), so the July verdict does not settle it; a fix needs its own measurement.

What: (1) build a small judged bench: replies where retrieved memories are unrelated to the turn, scored for unprompted mention; (2) compare arms: age/importance down-weighting, a lower default limit, a stricter render instruction, and on-demand retrieval (memory as a tool the character calls only when needed). (3) Keep the user dials working until a replacement ships: TASK-217 (inside doc-8) proposes retiring memoryScoreThreshold, and it is currently the main user-facing remedy for this report.

Acceptance: the bench exists, the chosen arm lowers unprompted-mention rate without regressing recall@10, and the user-facing remedy remains documented.

Blocked on: doc-8 re-entry design (owner direction 2026-10-04: cognition-like memory). Belongs to that pass as an acceptance criterion, not a standalone fix.
<!-- SECTION:DESCRIPTION:END -->
