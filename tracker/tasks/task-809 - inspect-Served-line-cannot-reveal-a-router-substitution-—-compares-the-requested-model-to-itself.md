---
id: TASK-809
title: >-
  /inspect Served line cannot reveal a router substitution — compares the
  requested model to itself
status: To Do
assignee: []
created_date: '2026-08-29 01:34'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 809000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/commands/inspect/embed.ts:177 reads llmResponse.modelUsed as the served model and flags substitution via !isSameModel(llmConfig.model, served) — but modelUsed holds the REQUESTED model (assignment: DiagnosticRecorders.ts:290, modelUsed: modelName), so for a router alias (openrouter/auto) the comparison is alias-vs-alias and the substitution flag can never fire. Found during the TASK-791 instrumentation slice.

Fix shape: the debug dump now carries routedModel beside modelUsed (shipped with the TASK-791 slice) — render it in the /inspect embed Served line (e.g. "openrouter/auto -> google/gemini-2.5-flash") and base the substitution flag on routedModel when present. USER-VISIBLE embed output change — owner taste call on the rendering before building.

Acceptance: an /inspect on an openrouter/auto turn names the routed model and flags the substitution; a direct-model turn renders unchanged.
<!-- SECTION:DESCRIPTION:END -->
