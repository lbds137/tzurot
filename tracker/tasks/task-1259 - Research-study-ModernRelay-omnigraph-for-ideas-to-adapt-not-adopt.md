---
id: TASK-1259
title: 'Research: study ModernRelay/omnigraph for ideas to adapt (not adopt)'
status: To Do
assignee: []
created_date: '2026-10-21 19:58'
labels:
  - 'area:memory'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1247000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila (2026-10-21): worth studying closely for ideas; no adoption, but adapt anything we want. Research only, not scheduled now.

What it is (README, read 2026-10-21): https://github.com/ModernRelay/omnigraph, MIT, Rust, ~6 months old. An object-storage graph database on the Lance format: typed ontology (.pg schemas enforced on write), graph traversal + vector ANN + full-text fused with RRF in one query, git-style branches with three-way merge and time travel, cluster config as code (plan/apply), Cedar policy on every mutation. Pitch: a shared typed world model for many agents.

Questions to answer, each with a verdict (adapt / already have / not for us):
- Hybrid retrieval: how do they fuse graph + vector + BM25, and does any of it change the plan for TASK-1181 (lexical leg) or the RRF arm already in services/ai-worker/src/services/eval/poolScoring.ts?
- Graph edges between memories or facts: would typed relations help fact supersession (TASK-671) or the memory epic (doc-8)?
- Branching and time travel for memory: anything that maps to per-persona or per-channel memory, or to reviewable memory edits?
- Typed ontology enforced on write: compare with our Zod and Prisma boundaries.
- Fleet angle (outside Tzurot; hand to Deck if it pans out): a shared world model for agents vs our role files, tracker and messages.

How: read the docs and the source of the query planner and fusion code; skim omnigraph-cookbooks for the agent-memory example. A read-lane worker can do the first pass (lane-meters --for read); verify quotes against the source.

Acceptance: a short note in docs/research/ (or docs/local/ if it is only operator notes) with a verdict per question, and a tracker task filed for each idea marked adapt.
<!-- SECTION:DESCRIPTION:END -->
