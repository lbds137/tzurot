### Theme: Provider Prompt Caching (cost-reduction epic)

_Focus: restructure prompt assembly so the prefix is stable enough to benefit from provider-side prompt caching (OpenRouter, z.ai, Anthropic-direct), without sacrificing freshness. Target: meaningful cost reduction on multi-turn conversations within the cache TTL window._

**DESIGN ACCEPTED 2026-07-05 (boulder #2)**: [`docs/proposals/backlog/prompt-assembly-architecture.md`](../../../docs/proposals/backlog/prompt-assembly-architecture.md) **supersedes this theme's fix-shape** — stability tiers (S0/S1/H/V), `<chat_log>` → real messages with multi-party mapping, verified per-provider cache matrix (first-party docs 2026-07-05), marker gating, eviction hysteresis, phased rollout with quality gates. This file remains the requirement/risk record; implementation phases pull from the artifact. Notable fact-check outcomes: the o-series system→user rewrite is DELETED (o-series deprecated; no current OpenAI model rejects `system`); OpenRouter cache_control pass-through is officially documented; Gemini-via-OpenRouter is implicit-automatic; Qwen routes need explicit markers; z.ai coding-endpoint caching needs the Phase-0 empirical check.

**Why this is the highest-leverage cost lever (user note 2026-07-03)**: this bot's spend is INPUT-token-dominated (the fact that killed the 402 max_tokens-reduction idea), and prompt caching discounts exactly the input side. Lived proof of magnitude: the user's Claude Code quota lasted dramatically longer than raw usage would predict purely because of its aggressive prompt caching — the same effect compounds most in long multi-turn conversations, which is precisely Tzurot's activated-channel shape.

Currently we deliberately _break_ caching with a `<request_id>` token in the system prompt at `services/ai-worker/src/services/PromptBuilder.ts:231`, added in commit `6bbb25c08` (cross-turn duplication detection epic) on the theory it would help suppress free-model repetition. The hypothesis behind the buster is shaky — provider prefix caching only changes billing, not stochastic sampling, so adding nondeterminism to the prefix shouldn't influence output behavior either way. **First phase verifies and removes if confirmed.**

#### Current architecture (relevant for caching design)

- **System prompt**: one large XML block built by `PromptBuilder.buildFullSystemPrompt()` at line 182 — identity, constraints, datetime, location, request_id, participants, memory archive (RAG), references, `<chat_log>` (full history), protocol/tail.
- **Messages array**: `[systemPrompt, currentMessage]` only. History lives _inside_ the system prompt, not as separate turns. `services/ai-worker/src/services/ConversationalRAGService.ts:164`.
- **Provider routing**: OpenRouter for most models (Anthropic, OpenAI, Gemini, GLM, DeepSeek), direct z.ai for some GLM. `ChatOpenAI` (LangChain) → custom OpenRouter fetch wrapper at `services/ai-worker/src/services/modelFactory/OpenRouterFetch.ts`.
- **Reasoning models**: `LLMInvoker.transformMessagesForReasoningModel` rewrites system→user — caching strategy must survive this.

#### Why placement matters less than prefix stability

Cache hits depend on the longest stable prefix between requests, regardless of system-vs-messages split. Three things invalidate the prefix today:

1. The deliberate `<request_id>` cache-breaker (line 231).
2. Growing `<chat_log>` in the system prompt (every new turn = new system prompt).
3. Per-turn RAG memory results inserted before the chat log.

#### Caching mechanics by provider

- **Anthropic on OpenRouter**: explicit `cache_control: { type: 'ephemeral' }` markers, 5-min TTL, ~25% cache-write premium. Best ROI for multi-turn conversations <5 min between turns.
- **OpenAI on OpenRouter**: automatic prefix caching for prompts >1024 tokens.
- **Gemini**: automatic context caching exposed via OpenRouter.
- **DeepSeek**: automatic prefix caching.
- **z.ai (GLM)**: needs investigation — caching support exists but mechanics on OpenRouter passthrough vs direct API differ; check whether the z.ai coding plan exposes the same surface.

#### Fix shape (multi-PR epic)

**Phase 1: Verify and remove the cache-breaker**

- Confirm via experimentation: does removing `<request_id>` cause measurable repetition on free models? Hypothesis: no, since prefix caching doesn't influence stochastic sampling.
- If repetition genuinely returned, root-cause via temperature / repetition_penalty rather than reintroducing a useless buster.

**Phase 2: Restructure prompt into stability tiers**

- **Stable** (cache target): persona identity, constraints, base instructions, protocol section. Move into a dedicated section that excludes datetime/RAG/history.
- **Conversation history**: extract `<chat_log>` from the system prompt into proper `messages` array entries (per-turn user/assistant alternation). Each completed turn becomes a frozen prefix the next turn can cache against.
- **Volatile** (cannot cache): current user message, RAG memory archive, datetime, references. Keep in the current turn only.

**Phase 3: Provider-aware `cache_control` insertion**

- For Anthropic routes: insert `cache_control: { type: 'ephemeral' }` at the end of the stable prefix and on the last completed turn in the messages array.
- For other providers: rely on automatic prefix caching once the prefix is stabilized.
- Investigate z.ai-direct caching docs and parity with the OpenRouter passthrough.

**Phase 4: Reasoning-model handling**

- `LLMInvoker.transformMessagesForReasoningModel` rewrites system→user — cache breakpoints must follow the transformation. Either move cache markers post-transform or design the stable section to survive the rewrite intact.

**Phase 5: Measurement**

- Add cache-hit telemetry (`{ providerCacheHit, cacheReadTokens, cacheWriteTokens }`) on every LLM completion. Without this we can't tell if the restructuring actually paid off.
- Cost-comparison: aggregate billing per-persona before/after across one bake-in week.

#### Risks

- **Cold-start cost per persona**: each persona needs its own warm cache; rarely-active personas pay the cache-write premium without recouping it. Net negative for low-traffic personas — design needs to handle the asymmetry.
- **Prefix-mismatch noise**: subtle whitespace or ordering changes between turns silently produce cache misses. Need diff-checking telemetry to detect.
- **Multi-replica architecture**: caching is provider-side (not per-replica), so this is fine — but worth confirming the provider key includes nothing replica-specific.

#### Out of scope (deliberately)

- Switching providers — caching epic is provider-agnostic restructuring.
- Memory-archive caching — RAG results change per query, inherently uncacheable.

#### Start

- `services/ai-worker/src/services/PromptBuilder.ts:182-310` — `buildFullSystemPrompt`, central restructure target.
- `services/ai-worker/src/services/PromptBuilder.ts:231` — `<request_id>` buster, first thing to verify-and-remove.
- `services/ai-worker/src/services/ConversationalRAGService.ts:164` — message array assembly point.
- `services/ai-worker/src/services/LLMInvoker.ts` `transformMessagesForReasoningModel` — reasoning-model rewrite path.
- `services/ai-worker/src/services/modelFactory/OpenRouterFetch.ts` — provider request-shape entrypoint where `cache_control` markers would land for Anthropic routes.
- Original cache-breaker commit: `6bbb25c08 feat(ai-worker): cross-turn duplication detection with retry`.

Surfaced 2026-05-07 during user-driven intake — recalled from earlier thinking.
