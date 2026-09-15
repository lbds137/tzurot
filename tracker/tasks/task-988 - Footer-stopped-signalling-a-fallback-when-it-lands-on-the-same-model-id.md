---
id: TASK-988
title: Footer stopped signalling a fallback when it lands on the same model id
status: To Do
assignee: []
created_date: '2026-09-15 01:59'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 984000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-15 with a debug payload. GLM 5.2 fell back from the z.ai coding plan to OpenRouter, and the footer no longer says a fallback happened. Owner reads this as collateral from the de-duplication work that stopped printing the model name twice: collapsing the DISPLAY was right, but the duplicated name was the only thing carrying the fact that a fallback occurred, so the signal went with it. Too blunt.

Evidence from the payload (debug-1853210a): llmConfig.provider is z-ai and llmResponse.modelUsed is z-ai/glm-5.2, while llmResponse.reasoningDebug.upstreamProvider is DigitalOcean. HYPOTHESIS, not confirmed: an upstreamProvider value is an OpenRouter-shaped field (OpenRouter names the provider it routed to; a direct z.ai call has no upstream to name), so the call went through OpenRouter while every field the footer reads still says z-ai. Confirm this before building - the whole fix shape depends on it.

Grep for fallbackFrom, didFallback, wasFallback, fallbackUsed and routedVia across services and packages returns NOTHING outside tests, so there appears to be no explicit fallback marker on the record at all. That is a negative existence claim from five vocabularies only; widen it with an xray sweep before relying on it.

Fix shape: record the fallback as an explicit field on the response rather than inferring it from a name mismatch, and have the footer read that field. The display can stay collapsed - one model name - while still marking the route. Same missing field is the likely shared cause of the partial log-channel reporting in the sibling task.

Acceptance: a same-model z.ai to OpenRouter fallback renders a footer that names the fallback without printing the model name twice; and a test pins that a non-fallback call does NOT render the marker.
<!-- SECTION:DESCRIPTION:END -->
