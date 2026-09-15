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

CORRECTION from the owner, same day, before any work started: an earlier draft of this task claimed the footer had lost the routing entirely and that every field it reads still said z-ai. That is FALSE. The footer rendered the model correctly AND said via OpenRouter, so it resolved the actual platform perfectly well. The ONLY thing missing is that nothing marked the route as a FALLBACK rather than the configured destination. Scope this task to that gap and nothing wider.

Evidence from the payload (debug-1853210a): llmConfig.provider is z-ai and llmResponse.modelUsed is z-ai/glm-5.2, while llmResponse.reasoningDebug.upstreamProvider is DigitalOcean. Read together with the footer actually saying via OpenRouter, the call went through OpenRouter while the CONFIGURED provider on the same record still reads z-ai.

That pairing is the important part, and it makes the fix smaller than first assumed. The configured provider and the resolved platform are BOTH already on the record and both already reach the render path - they are simply never compared. A divergence between them IS the fallback, so this may need no new marker field at all, only the comparison and a label. Verify that before adding a field: grep for fallbackFrom, didFallback, wasFallback, fallbackUsed and routedVia across services and packages returns nothing outside tests, so no explicit marker exists today, but the absence of a marker is not evidence that one is needed.

Fix shape (verify the premise above first): derive the fallback from the divergence already present, and label it. The display stays collapsed - one model name - while gaining a marker that the route was not the configured one. Whether the sibling log-channel task shares this cause is now OPEN rather than likely, since the footer clearly had the routing data and still did not report a fallback.

Acceptance: a same-model z.ai to OpenRouter fallback renders a footer that names the fallback without printing the model name twice; and a test pins that a non-fallback call does NOT render the marker.
<!-- SECTION:DESCRIPTION:END -->
