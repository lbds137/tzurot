---
id: TASK-809
title: >-
  /inspect Served line cannot reveal a router substitution — compares the
  requested model to itself
status: Done
assignee: []
created_date: '2026-08-29 01:34'
updated_date: '2026-08-29 22:26'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 809000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/commands/inspect/embed.ts:177 reads llmResponse.modelUsed as the served model and flags substitution via !isSameModel(llmConfig.model, served) — but modelUsed holds the REQUESTED model (assignment: DiagnosticRecorders.ts:290, modelUsed: modelName), so for a router alias (openrouter/auto) the comparison is alias-vs-alias and the substitution flag can never fire. Found during the TASK-791 instrumentation slice.

Fix shape: the debug dump now carries routedModel beside modelUsed (shipped with the TASK-791 slice) — render it in the /inspect embed Served line (e.g. "openrouter/auto -> google/gemini-2.5-flash") and base the substitution flag on routedModel when present. USER-VISIBLE embed output change — owner taste call on the rendering before building.

OWNER DECISION 2026-08-29: **APPROVED** — "for the decision points you refreshed me on, I'm on board with your recommendations", answering a refresher that recommended rendering the routed model in the Served line and basing the substitution flag on `routedModel`. The taste call the fix shape was waiting on is made; relabelled state:owner → state:ready.

COORDINATE WITH TASK-817 — do not build this in isolation. Later the same day the owner gave a design direction for the USER-FACING footer that covers the same underlying fact (a router alias resolving to a concrete model) and asked for it to read distinctly and tersely, candidate wording "routed"/"autorouted", rather than as a failure arrow. `/inspect` is the operator view of that same event. Deciding the vocabulary twice is how the two surfaces drift apart, so settle the wording once and apply it to both; TASK-817 carries the fuller analysis of why routing, structural substitution, and genuine fallback are three different things.

Acceptance: an /inspect on an openrouter/auto turn names the routed model and flags the substitution; a direct-model turn renders unchanged; and the vocabulary used matches whatever TASK-817 settles for the footer.
<!-- SECTION:DESCRIPTION:END -->
