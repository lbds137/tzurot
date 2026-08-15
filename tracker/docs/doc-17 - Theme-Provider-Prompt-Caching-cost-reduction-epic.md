---
id: doc-17
title: 'Theme: Provider Prompt Caching (cost-reduction epic)'
type: other
created_date: '2026-07-28 11:11'
---

### Theme: Provider Prompt Caching (cost-reduction epic)

_Focus: restructure prompt assembly so the prefix is stable enough to benefit from provider-side prompt caching (OpenRouter, z.ai, Anthropic-direct), without sacrificing freshness. Target: meaningful cost reduction on multi-turn conversations within the cache TTL window._

**DESIGN ACCEPTED 2026-07-05 (boulder #2)**: [`docs/proposals/backlog/prompt-assembly-architecture.md`](../../docs/proposals/backlog/prompt-assembly-architecture.md) **supersedes this theme's fix-shape** — stability tiers (S0/S1/H/V), `<chat_log>` → real messages with multi-party mapping, verified per-provider cache matrix (first-party docs 2026-07-05), marker gating, eviction hysteresis, phased rollout with quality gates. This file remains the requirement/risk record; implementation phases pull from the artifact. Notable fact-check outcomes: the o-series system→user rewrite is DELETED (o-series deprecated; no current OpenAI model rejects `system`); OpenRouter cache_control pass-through is officially documented; Gemini-via-OpenRouter is implicit-automatic; Qwen routes need explicit markers; z.ai coding-endpoint caching needs the Phase-0 empirical check.

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

---

## MEASURED 2026-08-01 — the phase table's "Phase 0 is independently valuable" is WRONG

Sizes below are from a real prod request (`/inspect` req `456ec221`, Lilith, GLM 5.2 via the
z.ai coding plan), not estimates. Billed prompt 47,820 tokens; system message 45,227.

| section | ~tokens | tier | line |
| --- | ---: | --- | ---: |
| `<system_identity>` | 4,730 | **S1 stable** (per persona) | 1 |
| `<context>`/`<datetime>` | 58 | V | 96 |
| `<request_id>` **(cache-buster, LIVE)** | 14 | V | 104 |
| `<participants>` | 599 | V | 107 |
| `<fact>` × 10 — RAG memory archive | 7,804 | V (per query) | 135 |
| `<contextual_references>` | 1,866 | V (per turn) | 444 |
| `<chat_log>` | 27,548 | H (grows every turn) | 525 |
| `<protocol>` | 2,604 | **S0 stable, byte-identical across ALL personas** | 1536 |

**Three findings that change the phasing:**

1. **Phase 0 as written buys ~0.** `<datetime>` (line 96) sits BEFORE `<request_id>` (line 104)
   and is equally volatile, so deleting the buster moves the cache breakpoint from line 96 to
   line 96. Measured delta: **+72 tokens.** Council confirmed independently (GLM 5.2, Qwen
   3.7 Max, 2026-08-01) — Qwen: _"the caching equivalent of removing the second lock on a door
   whose first lock is already broken."_ The buster still ships in prod; deleting it is correct
   (it is dead weight) but must not be sold as a caching win on its own.

2. **Prefix caching is strictly sequential, so Phase 2 cannot pay off before Phase 1** (Qwen,
   and it survives the premise error below). The messages array tokenizes AFTER the system
   message, so an unstable system message means NOTHING downstream caches — including a
   perfectly restructured history array. Extracting `<chat_log>` while the system message still
   carries volatile content delivers **zero** caching ROI. The phase table should say Phase 2
   *depends on* Phase 1 rather than implying either is independently bankable.

3. **`<protocol>` is stranded.** 2,604 tokens of S0 content — identical for every persona, so on
   automatic-prefix providers every persona would share those bytes — currently sits at the END,
   behind ~40k tokens of volatile content. The S0-before-S1 reorder §2.1 already calls for is
   worth **more than doubling** the cacheable prefix (4,730 → 7,334), and is most of Phase 1's
   realistic win.

**The real Phase 1 hoist**, therefore, is the whole V tier out of the system message —
datetime + request_id + participants + memory archive + references = **10,341 tokens** — not
just the timestamp. Ceiling once done but before history extraction: **~7,334 of 47,820 (15%)**.
The remaining 27,548 (58%) is `<chat_log>` and needs Phase 2's breakpoint B.

**Council-premise caveat, recorded so the numbers above are not re-derived from the bad ones:**
both models were given line numbers WITHOUT section contents and both independently assumed
lines 107–443 were a stable `<participants>` block worth ~8,400 tokens. It is actually 599
tokens of participants plus 7,804 tokens of per-query RAG memory — the most volatile content in
the prompt. Their shared "+8,400 from hoisting datetime" figure is wrong; the correct figure is
+72. Their convergent verdict (Phase 0 is not independently valuable) is unaffected, because it
rests on datetime preceding request_id, which is independent of the error. Finding #2 is also
unaffected. **If this question is councilled again, send the section table above, not line
numbers.**

## PHASE-0 SPIKE RESOLVED 2026-08-01 — the z.ai coding endpoint DOES cache

The design's one open empirical question ("z.ai implicit on standard endpoint, **coding endpoint
unverified**") is **answered, positively**. This was the gate on whether the whole epic pays off
on the dominant production route, so it was worth running before any restructuring.

Probe: three sequential `chat/completions` calls to `https://api.z.ai/api/coding/paas/v4`
(`glm-4.5-air`, `max_tokens: 1`), sharing a ~6.3k-token identical system prefix and differing
only in the final user line.

| call | `prompt_tokens` | `prompt_tokens_details.cached_tokens` | |
| --- | ---: | ---: | --- |
| 1 (cold) | 6,426 | **0** | warms the prefix |
| 2 (same prefix, new tail) | 6,426 | **6,272** | **97.6% cached** |
| 3 (same prefix, new tail) | 6,426 | **6,272** | stable |

Conclusions:

- **Implicit/automatic** — no `cache_control` markers required on this endpoint. The epic's
  Phase-3 marker work is therefore NOT needed for the z.ai route (it remains needed for
  Anthropic/Qwen via OpenRouter).
- **Field name: `usage.prompt_tokens_details.cached_tokens`** (nested, not top-level). This is
  what Phase-0's "cache telemetry fields" item must read; `rg cached_tokens` currently returns
  nothing in our source, so no code reads it today.
- **Granularity is fine, not all-or-nothing**: 6,272 of 6,426 cached, i.e. the shared prefix
  cached and only the ~154-token differing tail was re-billed. That is exactly the behaviour the
  stability-tier design assumes.
- `prompt_tokens` stays at full count — the discount is expressed via `cached_tokens`, not by
  reducing `prompt_tokens`. Any cost measurement must read the nested field, not infer from
  prompt totals.

**Not yet measured: the TTL.** Calls here were seconds apart. The cold-start economics in the
Risks section above (does a persona recoup the warm-up before the entry expires?) still needs a
gap-probe — re-run the same script with a deliberate delay between calls 2 and 3 to bracket it.

Probe method note: the script dumped the WHOLE `usage` object rather than reading a guessed field
name — which is what saved it. Its own verdict line printed "NO cache-named field in usage"
because it only scanned top-level keys and `cached_tokens` is nested one level down. The raw dump
showed the truth the summary logic got wrong.

**TASK-392** (`<contextual_references>` rendered byte-identically in BOTH the system message and
the user message, 1,866 tokens duplicated per referencing request) is **absorbed by this theme** —
artifact §2.2 already rules it: references live ONLY in the user message. Do not fix it as a
standalone dedup; it falls out of the V-tier hoist, and fixing it the other way (deleting the
user-message copy) would be exactly backwards for caching.

## Prod prefix-diff measurement 2026-08-15 (session probe, `pnpm ops cache:prefix-diff` + custom counters)

Two busiest channels of the 24h diagnostic window (1498247824662335608, 1481138179917615144);
20/20 consecutive same-personality prompt pairs diverge at EXACTLY the head of `<chat_log>` —
common prefix 29-35% (~30-31k chars, the pre-chat_log system prompt), everything after re-billed
every turn (~55-77k chars ≈ 14-19k tokens/turn).

**Mechanism pinned by entry counts: the slider is `DEFAULT_MAX_MESSAGES` (50), not budget
trimming.** Every measured prompt carries exactly 50 chat_log entries (48-49 where dedup drops a
couple) — the fetch/count cap slides one message per turn in any full channel. This is CONSISTENT
with §2.5.1's "budget trimming is dormant" (zero trimming events stands), and it REFINES §2.5:
chunked-eviction-with-hysteresis implemented only at the token-budget layer would never fire in
prod — the count cap slides first. The hysteresis policy must govern the message-count window
too (e.g. at cap, cut to ~75% and refill), or the cache win never materializes.

Also measured, feeding the minimal-user-turn PR: `<participants>` is byte-stable per render
(0/68 pairs changed over 19h in the busiest channel, hash-identical across 3 personalities);
where it churns (5/15 in a multi-user channel) part of the churn is the recency SORT ORDER, so
the block moves into the stable prefix with render order sorted by persona UUID (selection stays
recency-based). Entry timestamps are already absolute-only (cache-safe, verified in
`conversationUtils.ts`).

Open: `cachedPromptTokens: 0` on the 2026-08-15 incident request remains unexplained — the ~30k
stable prefix should have hit even under sliding; candidates are provider TTL vs. something
poisoning the prefix. Bracket the TTL per the gap-probe note above.
