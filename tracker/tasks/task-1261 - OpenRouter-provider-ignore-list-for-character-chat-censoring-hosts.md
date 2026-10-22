---
id: TASK-1261
title: OpenRouter provider ignore list for character chat (censoring hosts)
status: To Do
assignee: []
created_date: '2026-10-22 13:36'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1249000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila (2026-10-22) passed on an r/SillyTavernAI PSA (u/Dikki_Dikki, ~26 days old, 218 upvotes): sudden extra censorship on an open-weight model is usually OpenRouter routing the request to a host that adds its own filter layer. The post says to always ignore StreamLake, GMICloud, NovitaAI, AtlasCloud, Alibaba Cloud and SiliconFlow, and that the list can be longer per model. Community claim, not verified here.

Current state (git grep on develop 2026-10-22 for `provider: {`, allow_fallbacks, data_collection, providerPreferences: no hits in services/ or packages/ outside generated slash-command options): Tzurot sends no OpenRouter provider preferences, so OpenRouter picks the host freely.

What: (1) measure first: OpenRouter generation records name the serving provider; sample recent prod generations with refusal-shaped or empty replies and group by provider to see whether these hosts dominate; (2) if they do, send `provider: { ignore: [...] }` on chat-completion requests, the list in one common-types constant; (3) decide whether the list is global or per model and whether BYOK users can override it. Related: TASK-937 (vision chain stops on a content_policy refusal), whose refusals may share this cause.

More from the same thread (Lila 2026-10-22, community reports, unverified):
- DigitalOcean reportedly injects censorship rules into the system prompt (the OP agreed it adds and removes this periodically), although the ToS survey in TASK-1262 lists it as NSFW-allowed. So ToS permission and filtering behaviour are separate axes; this task is about behaviour.
- One user blacklists Alibaba Cloud, Friendli, MARA, Phala, SambaNova and SiliconFlow for hijacked prompts, frequent refusals or no prefill support (three of those are on the ToS-allowed list); finds DeepInfra and Novita workable because they allow thinking off and mid-reply continuation. Another reports censorship on Novita for the MiMo model.
- SiliconFlow reportedly replicates the official APIs including their censoring system prompts and settings; another user says provider-level filtering differs per model (Kimi K2.6 on SiliconFlow only has model-level refusals).
- A z.ai Lite-plan user reports heavy GLM 5.2 refusals on the official API with no way to change provider there (relevant to TASK-1262: the official endpoint is not filter-free either).
- Several commenters argue for an allowlist rather than an ignore list. Design consequence: support `provider.order`/`only` as well as `ignore`, keyed per model, and let the measurement decide which.

Acceptance: a measurement note, and either the ignore list shipped with a test asserting it crosses the request seam, or a recorded reason not to.
<!-- SECTION:DESCRIPTION:END -->
