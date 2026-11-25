---
id: TASK-1261
title: OpenRouter provider ignore list for character chat (censoring hosts)
status: In Progress
assignee:
  - Tzurot B
created_date: 2026-10-22 13:36
updated_date: '2026-11-25T07:48:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: high
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

Privacy axis (added 2026-11-21): HD Moore's canary study (Ars Technica, 2026-11) seeded ~2M prompts with unique secrets across AI routers and hosts. It found three compromised hosts whose requests were siphoned (some marked ZDR), resellers logging prompts, and a Chinese lab scraping URLs from prompts, including ones marked no-data-collection/ZDR, also when a US host forwarded to it. OpenRouter's 2026-11-21 notice to account holders names MiniMax models: URLs in prompts were fetched 40-130 h later, whether MiniMax served them or AtlasCloud, Novita or StreamLake forwarded to MiniMax; OpenRouter removed the ZDR label from those endpoints. Three of those forwarders are on the community ignore list above. Tzurot sends users' Discord conversations with no provider preferences (re-checked on develop 2026-11-21: `buildOpenRouterExtraParams` in services/ai-worker/src/services/ModelFactory.ts sends only transforms/route/verbosity), so OpenRouter may pick any host, including resellers that forward to the lab. This makes the task data-rights adjacent, so priority is now high. The study's own advice: pick upstream providers yourself rather than default pools; ZDR flags did not prevent leaks.

Owner question: should Tzurot pin OpenRouter routing for user conversations (an allowlist via `provider.only`/`order` with `allow_fallbacks: false`, plus `data_collection: 'deny'`), and exclude MiniMax models and hosts that forward to them, even where that removes cheaper or less-censored hosts?
Recommendation: yes, an allowlist of first-party or contractually direct hosts per model, plus data_collection deny, applied to the system key and offered as the default for BYOK; measure the refusal and cost effect on the allowed set before shipping (the censorship axis above).

Acceptance: a measurement note, and either the ignore list shipped with a test asserting it crosses the request seam, or a recorded reason not to.
OWNER RULING 2026-11-24 (Lila, AskUserQuestion in lane B's session; verified by lane A in B's transcript): "Yes, measure first". Pin OpenRouter provider routing per model on the system key (provider.only/order, allow_fallbacks false, data_collection deny), excluding MiniMax and the hosts that forward to it, and offer the same as the BYOK default. Measure the refusal and cost effect on dev before enabling. Relabelled state:ready (was state:owner); lane B builds it.

MEASUREMENT HALF DONE (PR #2810 merged 2026-11-25: `pnpm ops telemetry:upstream --env <env>`, host per model from the diagnostic logs). Prod, 7-day window, 35 OpenRouter rows: anthropic/claude-haiku-5.5 served only by Anthropic (7); z-ai/glm-5.3-flash spread over Relace 14, Together 3, Wafer 3, InferenceNet 3, BaseTen 2, OpenInference 1, plus 2 thrown failures with no host recorded (TASK-1541). Zero length, content_filter, error or empty finishes anywhere. No MiniMax host appears. The volume is too low to see a refusal or cost effect passively, so the dev measurement must be a deliberate pre-registered A/B (seyag:eval). The endpoints API (GET /api/v1/models/<id>/endpoints) gives each host's endpoint tag (relace, together, wafer, inference-net, baseten, open-inference) but carries no forwarding information, so the MiniMax-forwarder exclusion comes from the named list in the privacy section above (AtlasCloud, Novita, StreamLake, per OpenRouter's 2026-11-21 notice). The response `provider` field is a display name; `provider.only` takes endpoint tags, so the routing PR maps between them.

Remaining (routing PR): per-model allowlist constant on the system key, allow_fallbacks false, data_collection deny, BYOK default; every OpenRouter call site; the failure shape when no allowed host is up; the default for unlisted models; free-tier models under data_collection deny; dev A/B before enabling. Follow-ups from the report review: TASK-1547.
<!-- SECTION:DESCRIPTION:END -->
