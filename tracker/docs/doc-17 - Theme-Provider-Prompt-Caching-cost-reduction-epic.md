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

**Mechanism pinned by entry counts: the slider is the maxMessages COUNT cap, not budget
trimming.** Every measured prompt carries exactly 50 chat_log entries (48-49 where dedup drops a
couple) — those channels run the `DEFAULT_MAX_MESSAGES` default; the setting is user-configurable
(the owner runs 100, and an owner-supplied 2026-08-15 dump showed a 68-entry log with
`historyMessagesDropped: 0` — an unfull window does not slide). The cap slides one message per
turn in any FULL channel, whatever its configured value. This is CONSISTENT
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

## DESIGN PASS COMPLETE 2026-08-16 — §2.5.2 accepted; the beta.204 build is specced

The count-cap slider this doc's 2026-08-15 measurement pinned now has an accepted
design: **artifact §2.5.2** (quad council pass + owner sign-off, all open calls
resolved — 25% chunk, TASK-622 co-requisite, ConversationHistoryService windowed
fetch under one repeatable-read transaction). Build slices (PR 0 probe / PR 1 roster
/ PR 2 windowed fetch) live in the artifact. The TTL gap-probe and the
`cachedPromptTokens: 0` attribution are PR 0. This doc remains the
requirement/measurement record; the artifact owns the design.

## PR 0 MEASUREMENTS 2026-08-17 — z.ai cache mechanics probed, prod misses decomposed

Method: live probes against dev's real `ZAI_CODING_API_KEY` (`railway run --service
ai-worker` — `pnpm ops run` injects DATABASE_URL only), plus read-only queries over
prod's 226-row `llm_diagnostic_logs` window (22h). Synthetic filler only; no user
content. Probe scripts were scratch, not landed — method recorded here instead.

### Mechanics (dev, measured)

- **The response reports caching**: `usage.prompt_tokens_details.cached_tokens`.
  Immediate identical 9,009-token repeat → 8,960 cached (99.5%).
- **Block granularity is 64 tokens.** Every cached value across a 9-point size
  sweep is an exact multiple of 64 (64, 256, 576, 1152, 1728, 2304, 3456, 5760,
  11776). The trailing partial block never caches.
- **There is effectively no minimum cacheable length** — a 92-token prompt cached
  its first 64-token block. This CLOSES the "min-cacheable-length" candidate.
- **Caching is on the LONGEST MATCHING PREFIX, not on a whole-prompt match.**
  This is the measurement the epic's whole premise rested on and had never been
  taken:
  - identical system prefix + a DIFFERENT user tail → 8,192 / 8,599 cached (95.3%).
    Tail-append reuse works; stabilizing the head is worth doing.
  - stable front + CHANGED middle + stable back → 4,160 / 9,048 (46.0%). The hit
    is exactly the stable front, truncated at the first divergence, floored to a
    64-block.
  - one character changed at the FIRST token → 0 / 8,616. The only shape that
    yields a zero on a long prompt.
- **TTL is between 30 and 45 minutes** for an idle entry. Seven distinct
  prefixes were warmed at t=0 and one re-probed per checkpoint (so the run costs
  max(delay), not sum(delay)): 1/3/6/12/20/30 min all returned 99.8% with a
  byte-identical `cached` value, and 45 min returned 0/11,418. Scope: this
  brackets pure age for an **untouched** entry. A prod entry in a busy channel
  could also be evicted under cache pressure before its age runs out, which this
  probe cannot see — so treat (30, 45] as the ceiling on idle survival, not as a
  guaranteed lifetime.

### The billed discount is NOT measurable from any surface we have — ruled out, do not re-attempt

Both candidate instruments were checked. The chat/completions response carries
exactly seven top-level keys (`choices, created, id, model, object, request_id,
usage`) and no cost field of any kind. The quota endpoint
(`/api/monitor/usage/quota/limit`) reports its `TOKENS_LIMIT` windows as an INTEGER
`percentage` with no raw token counts — moving it by one point would require
billing ~1% of the plan window and would contaminate the owner's real quota, and
even then could not separate cached from uncached rates. So the docs' ~50% and this
doc's earlier ~80% both remain unverified and unverifiable here. This does not gate
anything: the discount changes the SIZE of the win, not its direction.

### Prod decomposition (226 diagnostic rows, 190 on zai-coding)

`cachedPromptTokens: 0` is not one unexplained incident — it is **91 of 190 calls
(48%)**. The 2026-08-16 incident request `f6f73154` is one of them: `zai-coding`
(so NOT an OpenRouter accounting artifact — that candidate is closed), glm-5.2,
55,837 prompt tokens, 0 cached.

Hit rate by idle gap since the previous call in the SAME channel:

| gap | calls | hit% |
| --- | --- | --- |
| first in window | 16 | 25.0 |
| < 2 min | 21 | 76.2 |
| 2–10 min | 109 | 63.3 |
| 10–30 min | 20 | 35.0 |
| 30 min – 2 h | 16 | 18.8 |
| > 2 h | 8 | 0.0 |

Monotonic decay, and the measured (30, 45] min TTL explains its shape: the >2h
bucket is 8/8 zero because no entry can survive that long, and the 30min-2h
bucket straddles the boundary. **But the decay BELOW 30 minutes is not expiry** —
an untouched entry demonstrably survived 30 minutes in the probe, so the 24% miss
inside the <2 min bucket and the 37% inside 2-10 min are prefix instability, not
age. Both causes are real, and the TTL measurement is what separates them.
Sample is small (n=8 in the largest-gap bucket); treat the curve's shape as
established and its exact breakpoints as not.

Depth of the hits that did land:

| hit depth | calls | mean cached | mean prompt |
| --- | --- | --- | --- |
| < 25% | 53 | 5,117 | 32,216 |
| 25–50% | 10 | 7,763 | 25,574 |
| 50–75% | 4 | 33,760 | 54,619 |
| 75–90% | 12 | 23,483 | 29,311 |
| ≥ 90% | 20 | 25,107 | 25,328 |

**The largest hit bucket re-bills the entire chat_log.** 53 of 99 hits cache ~5.1k
of ~32k. Section sizes on those same requests (from the stored `systemPromptSections`,
char counts only): platform_constraints 851 · output_constraints 1,069 · system_identity
15,220 · identity_constraints 420 · protocol 9,688 · location 166 · participants 936 ·
chat_log 62,696. Pre-chat_log totals ~28,350 chars.

Note what that does NOT say. ~5.1k cached tokens is BELOW the pre-chat_log region
(~7.9k tokens at a rough 3.6 chars/token), so on these requests the cut lands
**inside S1, before chat_log begins** — not at the chat_log boundary. So the head
slide is not the sole cause even here; an S1-side divergence is also cutting the
prefix. Which section it lands in is NOT established: these are means across
requests with different personas (system_identity alone is 15k chars and differs
per persona), and means of ratios cannot localize a boundary. Localizing it needs
per-request analysis with a real tokenizer — a live follow-up, not a settled fact.

### What this sets up for the rollout read

- PR 1 + PR 2 should move the shallow-hit bucket (53 calls, ~16% of prompt cached)
  toward the ≥90% bucket. That is the acceptance signal.
- They should NOT be expected to change the >30 min buckets at all. Anyone reading
  a post-deploy aggregate hit rate near 60% and concluding the epic failed would be
  reading expiry, not prefix stability. Read the <2 min bucket and the hit-depth
  distribution, not the headline ratio.
- The unlocalized S1 cut is the next open question, and it may bound the win.

## S1 CUT LOCALIZED 2026-08-17 (TASK-641) — it is persona alternation, recorded as INHERENT

Instrument: `pnpm ops cache:prefix-diff --env prod --channel <thread> --limit 15`.
The tool already existed and this doc already cited it (see the 2026-08-15 section);
a session re-derived its design from scratch before finding it. Thread snowflakes
work directly — `channel_id` records the thread's own id, measured, not the parent's.

Ten consecutive pairs from one owner thread (01:20–05:04 UTC). Divergences land in
exactly TWO sections, never anywhere else:

| pattern | pairs | common prefix | divergence |
| --- | --- | --- | --- |
| healthy tail-append | 7 | 90–99% | `H chat_log` |
| deep truncation | 1 | 25% | `H chat_log` @ 34,302 chars |
| prefix collapse | 2 | 5%, 1% | `S1 system_identity` @ **1956** |

**The S1 cut is persona alternation — inherent, not a defect.** Both S1 rows diverge
at the IDENTICAL offset 1956 and bracket a single request whose prompt is 41,775
chars where every neighbour is ~142,000; the main conversation's length continues
smoothly across it (142,316 → 145,315), so that request is an interloper, not part
of the same growing thread. Owner confirmed a different character spoke at that
point. Two personas share S0 plus a common identity preamble and split 1956 chars
in, which is the legitimate divergence §2.5.2 anticipated. **No S1-side fix is
indicated, and TASK-641's worry that "an S1 divergence may bound the win" does NOT
hold for this shape.**

**Reading caveat, load-bearing for anyone re-running this:** the tool diffs
CONSECUTIVE requests, but the provider caches the longest match across ALL recent
prefixes. An interloper therefore does not necessarily cost the next request its
hit — the following request can still match the prefix left by the one before the
interloper. Consecutive-pair diffing is a proxy for the cache lookup, not the
lookup. Do not convert an `S1` row into a billed miss without that check.

**The row that matters is the 25% one**: same persona, divergence INSIDE `chat_log`
at 34,302 chars (~9.5k tokens, floored to a 9,472-token block). Not alternation and
not tail-append — the history window's head moved. First direct prod observation of
the head-slide that beta.204 PR 2's count-cap hysteresis exists to stop; previously
this was inferred from aggregates only.

### Second thread (8 pairs, same day) — corroborates, and exposes a sampling error

8/8 divergences at `H chat_log`, 90-99%, single persona throughout, ZERO S1
divergences. Confirms the alternation finding by its absence: no second character,
no S1 cut.

**CORRECTION to the paragraph this replaces, which claimed TASK-641's localization
question was answered. It is NOT.** The arithmetic does not close:

| divergence observed | offset | ~tokens @3.6 chars |
| --- | --- | --- |
| `S1 system_identity` (alternation) | 1,956 chars | ~543 |
| `H chat_log` (healthy append, 15 pairs) | 129,216-135,702 | ~35,900-37,700 |
| `H chat_log` (the one deep case) | 34,302 | ~9,528 |

The shallow-hit population is 53 calls, mean cached 5,117 tokens, all under the
<25% ceiling of ~8,054 tokens (~29,000 chars). **Nothing sampled lands in the
18,000-29,000 char band where that population sits** — S1 cuts are ~15x too small
to average 5,117, the chat_log cuts ~4x too large. Two healthy threads did not
reproduce the shape.

**The sampling error is the lesson**: channels were sampled, when SHALLOW HITS
needed sampling. `cache:prefix-diff` takes `--channel`/`--personality` and cannot
filter on cache depth, so it cannot find its own subject. Closing TASK-641 needs
the rows selected by `cachedPromptTokens/promptTokens < 0.25` FIRST, then diffed —
either a `--min-depth`/`--request` selector on the tool, or a prod query joining
diagnostic rows to their usage numbers.

**Established regardless**: divergences occur in exactly two sections, never a
third; S1 cuts are persona alternation and inherent (owner-confirmed); and the
one deep chat_log cut at 34,302 chars is the first direct prod sighting of the
head-slide beta.204 PR 2 targets.

## TASK-641 CLOSED 2026-08-17 — the shallow-hit cut is chat_log head-slide, NOT S1

Supersedes the correction above. Sampling shallow HITS (not channels) resolved it.

Method that worked, after sampling channels twice and drawing only healthy threads:
select rows by `cachedPromptTokens/promptTokens < 0.25` across ALL channels first
(`llmResponse.promptTokens` / `llmResponse.cachedPromptTokens` — NOT nested under
`usage`; a guessed `usage` path returned 0 of 202 rows and the self-check caught
it), then run `cache:prefix-diff` on the channels that surface.

**The tell, visible before any diffing: cached tokens are CONSTANT per channel
while prompt length varies freely.** ch-1498 cached 5,632 across prompts of
25,989-34,026; ch-1481 cached 6,656 across 28,280-34,426. A fixed byte offset,
not a fluctuating one.

Diffing confirms it — 19 of 20 consecutive pairs diverge at `H chat_log`, at a
per-channel CONSTANT offset, under prompt lengths that swing 10,000+ chars:

| channel | divergence band | prompt range | cached | offset/cached |
| --- | --- | --- | --- | --- |
| 1498…608 | 27,451-27,465 (14 chars, 12 pairs) | 84,769-94,862 | 5,632 | 4.88 ch/tok |
| 1481…144 | 32,334-32,451 (117 chars, 7 pairs) | 106,830-110,877 | 6,656 | 4.87 ch/tok |

Three independent numbers agree: the divergence offset divided by the billed
cached tokens gives 4.88 and 4.87 chars/token in two unrelated channels, and
27,455 chars matches this doc's own earlier independent measurement of the
pre-chat_log sections (~28,350) within 3%. So the cut sits essentially AT the
chat_log boundary: S0 and S1 cache, and **the ENTIRE chat log is invalidated
every turn** — the window head moving, which is exactly what beta.204 PR 2's
count-cap hysteresis stops. Single model and single persona throughout both
channels, so alternation is excluded.

**TASK-641's premise is REFUTED, and this is the good outcome.** The task feared
"an S1-side divergence is truncating the prefix in addition to the head slide…
if S1 cuts at ~5.1k, stabilizing chat_log below that point buys nothing." S1 is
NOT the cutter. The ~5.1k mean was the chat_log boundary measured in tokens, not
an S1 defect. Nothing bounds the win from the S1 side.

Residual S1 cuts, both minor and neither the shallow-hit driver:
- `S1 participants` (1 of 20 pairs) — roster change mid-conversation. Real, small,
  the residue of the TASK-622 roster-stability work.
- `S1 system_identity` (2 pairs in a separate thread, offset 1956) — persona
  alternation, owner-confirmed, inherent. See the section above.

**Projected win (PROJECTION, not measured):** these channels sit at 29-32% cached.
With the chat_log head held stable across a hysteresis chunk, the cacheable prefix
should extend from the chat_log boundary toward the log's tail. That is the ≥90%
bucket the rollout read is looking for. Measure it on the <2 min gap bucket
post-deploy, per the acceptance note above.
