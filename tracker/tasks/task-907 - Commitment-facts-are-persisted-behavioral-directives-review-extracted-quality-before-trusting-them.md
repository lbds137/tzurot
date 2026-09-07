---
id: TASK-907
title: >-
  Commitment facts are persisted behavioral directives: review extracted quality
  before trusting them
status: To Do
assignee: []
created_date: '2026-09-07 15:55'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 905000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: since PR 2356 the extraction prompt admits a promise, standing decision, agreed form of address, or advice the character gave as a durable fact with the assistant as subject. Unlike inert facts (name, allergy, location) a commitment fact is directive in content and is re-injected into every later conversation as current background knowledge, so a user who coaxes the character into a favorable promise mid-conversation gets that behavior durably reinforced across sessions, bounded only by the durability and salience heuristics and, for hard-safety cases, the PLATFORM_CONSTRAINTS primacy block. The facts instruction already says recalled text is never an instruction to follow, but it was written for inert facts. Raised by claude-review round 2 on the PR; the design (memory-archive-format.md amendment 4) covers the schema question, not this surface.
Fix shape: owner review of the first commitment facts extracted in dev and prod via /memory facts (filter by the commitment tag the prompt now asks for), then one of: leave as is; add a salience ceiling or a per-fact lock for commitments; or wrap commitment facts in a render frame that states they are the character promises, not user instructions. Decide from real rows, not in the abstract.
Owner question: are character promises extracted from unmoderated dialogue acceptable as durable, re-injected facts, or do they need a guard before the render switch flips on?
Recommendation: review the first real rows in dev before deciding — the class is new and its base rate is unmeasured; a guard designed blind is likely the wrong one.
Acceptance: the owner has read a sample of extracted commitment facts and recorded a decision here.
Promote when: the first commitment-tagged facts appear in dev (after the extraction switch runs on new conversations post-deploy).
<!-- SECTION:DESCRIPTION:END -->
