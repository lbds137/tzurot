---
id: TASK-965
title: >-
  The debug payload should record the resolved config overrides the turn ran
  with
status: To Do
assignee: []
created_date: '2026-09-13 17:49'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 962000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 2026-09-13 dev payload — the owner had just turned cross-channel history back on, and the payload showed crossChannelMessagesIncluded: 0 with no way to tell whether the setting resolved false, the override cascade cache (packages/config-resolver BaseConfigResolver TTLCache) had not expired, or a channel-level override won. The payload carries llmConfig (model, provider, params) but not the ResolvedConfigOverrides that ContextAssembler reads (services/ai-worker/src/services/context/ContextAssembler.ts ~213: crossChannelEnabled: configOverrides?.crossChannelHistoryEnabled === true). The 2026-02-03 post-mortem (context settings not cascading) is the same blind spot.
Fix shape: add resolvedOverrides (the ResolvedConfigOverrides object, or the subset that affects assembly: crossChannelHistoryEnabled, the context tiers, the memory switches) to the DiagnosticCollector snapshot and render the booleans in /inspect Context view. Additive JSONB, no migration; no secrets in that object (verify by reading the schema before adding it wholesale).
Acceptance: /inspect on a turn shows which context settings resolved true; a payload from a turn with cross-channel history on names it.
<!-- SECTION:DESCRIPTION:END -->
