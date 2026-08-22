---
id: TASK-736
title: Reasoning view interpolates thinking text without escapeFenceBreaks
status: To Do
assignee: []
created_date: '2026-08-23 00:12'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 736000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2188 R3 fixed the Messages view mis-pairing fences across concatenated messages via escapeFenceBreaks. buildReasoningTextView (services/bot-client/src/commands/inspect/views.ts:248, verified in the #2188 round-3 sweep) ships raw ${thinking} into chunkedText the same way — the one remaining chunkedText producer without the neutralizer. Weaker trigger than Messages: a reasoning trace is ONE document, so fences usually pair within it; the mis-pair needs an unbalanced fence (e.g. a truncated trace), and the damage is cosmetic mid-split rendering, self-healing on the next chunk.

Fix shape: wrap thinking in escapeFenceBreaks in buildReasoningTextView + a backtick regression test, mirroring the Messages fix. Note the two-tier byte-identical contract (diagnostic log vs persisted history) is preserved automatically — both tiers call this one function.

Acceptance: raw ``` runs from thinking content never reach chunkedText.text; test pins it.
<!-- SECTION:DESCRIPTION:END -->
