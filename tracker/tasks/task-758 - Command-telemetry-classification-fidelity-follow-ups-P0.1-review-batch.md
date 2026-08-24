---
id: TASK-758
title: Command-telemetry classification fidelity follow-ups (P0.1 review batch)
status: To Do
assignee: []
created_date: '2026-08-24 03:18'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 758000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three non-blocking accuracy notes from the PR 2205 review rounds, batched because all three sharpen the same command_events classification fidelity and none blocks the P0 data being useful.
1. Sticky outcome slot has no mechanical enforcement - a failed/uncertain render is assumed terminal per convention (verified across call sites at authoring time, commandOutcomeSlot.ts documents it); a future non-terminal warning render would silently misclassify the invocation. Fix shape: lint rule or runtime assert that noteRenderedOutcome fires at most once per invocation, or an explicit accepted-risk note.
2. classifyChannelKind returns guild for a thread whose channel is not in the client cache (interaction.channel null) - the code comment claims thread always wins but cannot when uncached. Fix shape: find a cache-independent thread signal or soften the comment.
3. RecordCommandEventRequestSchema context values allow NaN/Infinity (no .finite()) - JSON.stringify silently nulls them in JSONB. One-token schema fix; natural rider on the P1.2 inference-context work that first populates context.
Acceptance: each item either fixed with a test or explicitly accepted in the module doc; the classifyChannelKind comment matches actual behavior.
<!-- SECTION:DESCRIPTION:END -->
