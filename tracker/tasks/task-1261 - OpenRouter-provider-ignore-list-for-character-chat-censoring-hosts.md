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

ROUTING PROBES 2026-11-25 (lane B, dev key, 8-token requests, results in this order):
- `provider.only` accepts bare slugs (`together` → served by Together) and full tags (`baseten/fp8` → BaseTen); a bare slug admits every variant of that host. This corrects the "provider.only takes endpoint tags" line above.
- No allowed host → HTTP 404 "No allowed providers are available for the selected model" with `failed_routing_step: Filter by Allowed Providers`. On code reading (not runtime-confirmed), apiErrorParser maps status 404 to MODEL_NOT_FOUND, which is permanent (no retry) and is cached by the vision chain at the long TTL. The user sees "The requested AI model is not available. Please try again or use a different personality." The routing PR should classify routing exhaustion as its own retryable category.
- `openrouter/free` with `data_collection: deny` → 200, routed to `baidu/ernie-5.5-flash-preview:free` (host Baidu). The free router survives deny, but the router alone picks both the model and the host.
- `nvidia/nemotron-3.5-lightning:free` → 404 with AND without deny ("Free model training violation (account settings)"). The dev account's privacy setting already excludes free endpoints that train, so deny changes nothing there.
- `z-ai` (first party) and `anthropic` both serve under only + allow_fallbacks false + deny.
- The endpoints API has no data-policy or ZDR field on any endpoint (union of keys over all 41 glm-5.3-flash endpoints). Deny is enforced only server-side.
- glm-5.3-flash has 41 endpoints. Novita and StreamLake are live among them, so the forwarder exclusion is not hypothetical. Output price per 1M tokens: Relace fp4 $0.08 (14 of 35 prod rows), Wafer $0.18–0.24, Together, Fireworks, BaseTen, DeepInfra and Z.AI $0.34–0.50.
- Seam: OpenRouterFetch copies named extraParams fields onto the body, so `provider` needs its own field and a seam test there. Conversation, vision and system calls all go through `buildOpenRouterModel`, so the pin hangs there and NOT on the promptCaching gate. `ApiKeyResolver.getSystemApiKey` fills the system key in, so "apiKey set" does not mean BYOK. The BYOK branch needs an explicit flag.
- Router aliases (`openrouter/auto`, `openrouter/free`) cannot take a per-model `only`, so the unlisted-model default is ignore-shaped (the forwarders plus deny).

OWNER RULINGS 2026-11-25 (Lila, AskUserQuestion in lane B):
1. GLM hosts: "I don't care so much about the ToS as I care about whether the output gets blocked or censored." Host ToS is therefore NOT a filter. The GLM allowlist is chosen from measured refusal and censorship behaviour per host, which the pre-registered dev A/B (seyag:eval) supplies. The candidate set is every glm-5.3-flash host minus the MiniMax forwarders (Novita, StreamLake, AtlasCloud) and minus the community-reported filtering hosts in the Description (GMICloud, Alibaba Cloud, SiliconFlow; DigitalOcean for prompt injection), kept as A/B arms where they are live.
2. Free tier: data_collection deny plus the forwarder ignore list on `openrouter/free`. The router still picks the model and host.
3. Unlisted models and router aliases: deny plus the forwarder ignore list only. `minimax/*` model ids stay usable. Only MiniMax and its forwarders are avoided as hosts.
4. BYOK: same routing by default in this PR. The opt-out setting is a follow-up (TASK-1550).
5. A/B corpus (AUQ 2026-11-25): "Two stages (Recommended)". Stage 1 screens every eligible glm-5.3-flash host on an authored adult character corpus (no real conversations), with first-party Z.AI as the anchor. Stage 2 replays the owner-approved TASK-1400 real-turn sample ONLY on the Stage 1 shortlist. Approved spend ~$5–8, metered OpenRouter.

A/B PRE-REGISTERED 2026-11-25 (lane B, local pre-registration; seyag:eval measurement shape). Sizing probe under the ship conditions (`only` + allow_fallbacks false + deny, 16 tokens): 30 of 32 hosts served, with the served host equal to the pinned one. Fireworks and Tenstorrent returned 429 (availability, retried at run time). No host 404s under deny. Excluded before running: Novita and StreamLake (forwarders) and Darkbloom (32k context). Arm unit is the bare slug.

Exclusion rule, frozen:
- a hard block where the anchor never blocked;
- a censor rate above the anchor's by more than max(noise band, 10 pp);
- any flagged benign control;
- more than 10% unavailable.

Cannot-decide triggers:
- fewer than 3 hosts pass;
- the anchor's censor rate is above 30%;
- the judge fails its gate proof;
- the corpus fails its positive control.

The judge is glm-5.3 on the Z.ai plan.

A/B OUTCOME 2026-11-25. About 3,700 billed calls on the dev key, $8.02, metered and matched against the key's usage.
- **Stage 1** (authored corpus, 32 hosts screened under the ship conditions): 30 shortlisted.
  - Makora was excluded for a flagged benign control.
  - Tenstorrent was excluded at 34.7% unavailable.
  - The anchor censor rate was 0.7%, and the measured noise band was 3.5 pp, so the 10 pp floor applied. The largest kept Δ was 9.0 pp (Baseten).
  - The judge passed its gate proof on both classes.
- **Stage 2** (real-turn sample, about 69k-token prompts, 2 reps per host): no host removed.
  - The anchor scored 80/80 clean. 28 hosts had zero flags, and SiliconFlow had 2/40.
  - All 7 unavailable calls were 429s, and the worst host was at exactly 10%.
  - Scope limit: the judge catches out-of-character refusals on real turns (20/20), but its sensitivity to sanitizing on real turns was only partially shown. Stage 1 is the evidence for sanitizing.
- **GLM-5.3-flash allowlist** (30 bare slugs, `provider.only`, no `order`):

  z-ai, baidu, baseten, cohere, coreweave, crusoe, deepinfra, digitalocean, fireworks, friendli, inceptron, inference-net, kt, mistral, modal, morph, near-ai, nebius, open-inference, parasail, pareto-inference, particle-ai, reka, relace, river, sail-research, siliconflow, together, venice, wafer.

- **Excluded:**

  | Host | Reason |
  |---|---|
  | makora | benign-control flag |
  | tenstorrent | availability |
  | novita, streamlake | MiniMax forwarders |
  | darkbloom | 32k context |

- **Cost:** the cheapest host (Relace, the largest observed prod share) stays in. The projected blended price is unchanged within about 1%. That is a projection, not a measurement.
- **Retest:**
  - the endpoint list or a host's quantization changes;
  - the default character model moves off glm-5.3-flash;
  - a filtering or forwarding report about a listed host;
  - `content_filter` shows up in telemetry for a listed host;
  - expiry 2027-02-25.

Remaining (routing PR): per-model allowlist constant (above) on the system key, allow_fallbacks false, data_collection deny, BYOK default (opt-out TASK-1550); unlisted models and free tier get deny + the forwarder ignore list (owner rulings 2026-11-25); every OpenRouter call site; the failure shape when no allowed host is up (a routing-exhaustion 404 must not map to model-not-found); provider routing in the model cache key. Follow-ups from the report review: TASK-1547.
<!-- SECTION:DESCRIPTION:END -->
