---
id: TASK-1262
title: >-
  Z.ai Terms of Use ban sexually explicit content, and prod character chat runs
  on the Z.ai plan
status: To Do
assignee: []
created_date: '2026-10-22 13:38'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: high
ordinal: 1250000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a reply in the same r/SillyTavernAI thread as TASK-1261 (u/Xiaomin4114, ToS survey, ~26 days old) lists z-ai among providers whose terms specifically ban NSFW. Checked directly 2026-10-22: the Z.ai Terms of Use (docs.z.ai/legal-agreement/terms-of-use, updated 2026-04-14) prohibit at III.3(f) "obscene, pornographic" content and at III.3(g) content that is "sexually explicit, suggestive", and II / XI.2(f) allow suspending or terminating the account for violations.

Exposure: prod replies run on glm-5.3-flash through the owner Z.ai coding plan (prod ai-worker logs 2026-10-21), the extraction worker and summarizers run there too (05-tooling.md, Model calls from tooling), and character chats include adult content (the owner, 2026-10-21, re Voxtral refusals). A suspension would cut both Tzurot replies and the plan the owner uses for the rest of her coding fleet. No enforcement has been observed; this is a terms risk, not an incident. The owner (2026-10-22): no censorship on the Z.ai coding plan so far for mildly spicy content. That rules out a live filter at that level, but not after-the-fact enforcement: the terms describe suspension, and the server-side logs of what was sent are on Z.ai, not ours.

The same survey (community reading of ToS, not verified here beyond Z.ai) lists as NSFW-banning: Alibaba Cloud, Atlas Cloud, Baseten, Cerebras, GMICloud, Google, Inceptron, Inference-net, io-net, Mancer, Novita, Prime Intellect, Reka, RunWare, SiliconFlow, Streamlake, Together, z-ai; ambiguous "offensive/obscene" clauses: ollama, tensorix, moonshot-ai, friendli, fireworks, ionstream, open-inference, relace, sail research, modal, baidu, morph, chutes, groq, modelrun, near-ai, nextbit; NSFW RP allowed: uomi router, akashml, coreweave, decart, deepinfra, greenference, heabsy, nube, pareto, tinfoil, wafer, cohere, mistral, auro, arliai, arnict, aster, crusoe, kitani, lilac, makora, mara, nebius, parasail, phala, samba nova, scx, venice, cloudflare, digitalocean, engyai (low context limits). Google matters for TASK-1187 (Gemini STT eval).

Owner question: should adult-content character traffic keep running on the Z.ai plan despite its terms?
Recommendation: move chat replies (and memory extraction, which reads the same content) for adult-enabled personas to GLM on a host whose terms allow it, via OpenRouter with a provider allowlist (TASK-1261 builds that mechanism), and keep the Z.ai plan for tooling and SFW work; verify the chosen host terms first. Cost changes from flat-rate to per-token, so it is a spend call.

Acceptance: the owner ruling recorded here, and a follow-up task for whatever it decides.
<!-- SECTION:DESCRIPTION:END -->
