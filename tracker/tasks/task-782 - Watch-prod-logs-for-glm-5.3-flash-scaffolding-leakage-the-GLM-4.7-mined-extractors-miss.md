---
id: TASK-782
title: >-
  Watch prod logs for glm-5.3-flash scaffolding leakage the GLM-4.7-mined
  extractors miss
status: To Do
assignee: []
created_date: '2026-08-27 07:02'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 782000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: thinkingExtraction.ts and duplicateDetection.ts carry regex extractors mined from GLM-4.7 observed failure shapes (bare <from_id> echo, meta-preamble leakage, intra-turn stop-token failures). They are shape-based and unconditional, so they run against glm-5.3-flash output — but the new piggyback (PR #2236) may leak scaffolding in shapes they do not catch, and this class only surfaces under production volume (claude-review observation on #2236).

What: after the release deploying #2236 plus the free-default preset flip, sweep prod ai-worker logs for persona responses carrying scaffolding artifacts (from_id echoes, meta-preambles, reasoning-tag residue) attributed to glm-5.3-flash; check whether the existing extractors fired or missed.

Acceptance: either a log sweep showing no uncaught leakage (close), or new observed shapes filed with specimens for the Chain-of-Extractors (model-agnostic strips preferred per the GLM-family pattern).
<!-- SECTION:DESCRIPTION:END -->
