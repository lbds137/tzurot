---
id: TASK-915
title: Sweep the burn-in dual-path prose in ai-worker context assembly
status: To Do
assignee: []
created_date: '2026-09-08 04:50'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 913000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the worker-side context layer still describes itself as one half of a burn-in against a legacy bot-side assembly path (the framing from the shadow-mode migration). Part of that path is retired: since commit 94d84fe75 (2026-06-22) MessageContextBuilder no longer calls resolveExtendedContextPersonaIds (grep -n resolveExtendedContextPersonaIds services/bot-client/src/services/MessageContextBuilder.ts -> none), while it still shares mergeWithHistory (line ~221). So the shared-implementation guarantee in the ContextAssembler.ts docblock is stale for the resolver and true for the merge, and the other sites need the same per-claim read. Surfaced by claude-review round 2 on PR 2367, which swept the resolver attribution class but not this phrasing.
Fix shape: read each site and rewrite to the current design (which kernels are still shared, which divergences are permanent rather than burn-in). Enumeration: grep -rn -i "burn-in\|bot-side path\|legacy bot-side" services/ai-worker/src --include=*.ts minus tests -> ContextAssembler.ts (docblock lines ~5-16 incl. the MessageContextBuilder steps 1-4 mirror claim, and line ~419), context/types.ts (~70-72), context/referenceEnricher.ts (~14), context/visionDescriptionWriter.ts (~17). Comment-only; verify each rewritten claim against MessageContextBuilder.ts before writing it.
Acceptance: the grep above returns zero hits in non-test files; every rewritten sentence names a kernel or divergence that a grep of MessageContextBuilder.ts confirms; no code change.
<!-- SECTION:DESCRIPTION:END -->
