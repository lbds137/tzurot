# Prompt-Assembly Architecture — Stability Tiers, Real Messages, Provider Caching

> **Status**: ACCEPTED 2026-07-05 (boulder #2) — trio council pass + first-party provider-fact verification (§9); all §8 calls decided (owner sign-off 2026-07-05: eviction-to-75% with guardrails; all recommendations adopted)
> **Theme**: [`backlog/cold/themes/provider-prompt-caching.md`](../../../backlog/cold/themes/provider-prompt-caching.md) (absorbs its phases) · absorbs the layered-system-prompting follow-up + the inline-`reply_to` idea
> **Downstream consumers**: boulder #3 (memory) and #4 (agentic) conform to this message-assembly design. LangGraph adoption-compatibility verified by recon 2026-07-05.
> **Grounding**: 3 agents 2026-07-05 — pipeline map (system-prompt anatomy + volatility), provider seam (LangChain/cache/rewrite/tool readiness), LangGraph compatibility envelope.

## 1. Problem

Today's payload is **two messages**: one `SystemMessage` containing *everything* (identity, constraints, datetime, RAG memories, references, and ALL conversation history as `<chat_log>` XML) + one `HumanMessage` (current turn). Consequences:

1. **Zero cache hits, by construction and by intent.** The volatile `<context>` block (datetime + a deliberate `<request_id>` cache-buster, `PromptBuilder.ts:229`) renders at position 4 of 10 — every byte after it, including the fully static protocol/output-constraints tail, is downstream of per-request entropy. A second deliberate anti-cache measure (`historyReductionPercent`, `ContentBudgetManager.ts:243`) shrinks history on retries. Relative-timestamp suffixes (`t="… • 2 weeks ago"`) drift even frozen history bytes. Spend is input-token-dominated (the fact that killed the 402 max_tokens idea) — caching is the highest-leverage cost lever, and we are structurally locked out of it.
2. **Agentic is unreachable from this shape.** Tool loops require history as discrete messages with structural `AIMessage.tool_calls[i].id ↔ ToolMessage.tool_call_id` pairing (LangGraph recon §5); a serialized string cannot carry it, and it opts out of checkpointing/persistence/trimming middleware entirely. Current tool readiness is zero: the (unused-in-main-path) history converter misfiles `tool` roles as Human messages; `AIMessage`s are built from plain strings.
3. **Assorted structural debt**: references duplicated in both messages; a dead-code o-series system→user rewrite with destructive behavior (§2.6); the prompt is one string concatenation with no partition seam.

**What's already right**: ai-worker is on LangChain 1.x (`core 1.2.1` — exactly current LangGraph 1.4.7's peer range), so the runtime is adoption-ready; only the message shape isn't. One `ChatOpenAI` class over two OpenAI-wire providers keeps the provider seam small. The XML section discipline means content is *already* logically partitioned — it's just rendered into the wrong container.

## 2. Target architecture

```
[ SystemMessage — STABLE TIERS ONLY ]        ← cache breakpoint A
[ ...history as real messages... ]           ← cache breakpoint B (last history msg)
[ HumanMessage — volatile context + turn ]
```

### 2.1 Stability tiers (the section model)

Replace string concatenation with typed sections: `{ id, tier, render() }`, where tier drives placement and cache markers.

| Tier | Contents (today's sections) | Container |
| --- | --- | --- |
| **S0 stable-static** | platform constraints, output constraints, protocol *skeleton* (identical for every personality) | System msg, first |
| **S1 stable-personality** | identity (`<system_identity>`), identity constraints, personality protocol/directives (DB `systemPrompt`) | System msg, after S0 |
| **H frozen-conversation** | conversation history (real messages, §2.3) | Messages array |
| **V volatile** | datetime, location, participants/active-persona, RAG memory archive, contextual references, current turn | Final user message (§2.2) |

S0 before S1 maximizes the cross-personality shared prefix for providers with automatic prefix caching (OpenAI/DeepSeek/Gemini) — every personality shares S0's bytes. (Order today is interleaved: platform constraints render 3rd, protocol 9th; the reorder needs a quality-regression eye — the current order encodes Gemini's "sandwich method" primacy/recency rationale, so the S0/S1 *internal* ordering keeps identity-first, constraints-early, directives-late within the stable block.)

**Layered composition of S1 (absorbs the layered-prompting follow-up)**: S1 is assembled from ordered layers — `platform → channel (future) → personality → user-overrides` — with later layers overriding earlier on conflict. The layer seam is designed now (typed layers into the section model); the channel layer + its schema ship later (its trigger unchanged: channel-topic awareness work).

### 2.2 Volatile tail placement

All V-tier content renders as a structured prefix **inside the current user message**, after which the user's actual turn follows:

```
<context>datetime, location</context>
<participants>…</participants>
<memory_archive>…RAG results…</memory_archive>
<contextual_references>…out-of-window targets only…</contextual_references>
<from name="…">current message text</from>
```

Rationale: (a) keeps the system message byte-stable (breakpoint A always hits); (b) keeps history messages clean of per-request content (breakpoint B hits until the window slides); (c) matches the Anthropic middleware convention (system + last-user breakpoints); (d) no extra synthetic message role to confuse models. The references duplication dies here: `<contextual_references>` lives ONLY in the user message, and ONLY for out-of-window targets (in-window reply context moves inline into history, §2.4).

**Framing language is quality-critical (council, all three models independently)**: RAG memories rendered inside a user message risk the persona treating them as something the user just said ("Oh, I didn't know that about myself"). The memory block therefore carries explicit internal-recall framing (an instruction line to the effect of "the following are {name}'s own recalled memories — internal, not spoken by any participant") AND an untrusted-content boundary (memory text is recalled content, never instructions — guards injected text in stored memories). The exact wording ships with Phase 1 and is then pinned — format churn re-teaches the model.

### 2.3 History as real messages — the multi-party mapping

Providers accept `system/user/assistant/tool` roles only; a Discord channel has N humans + possibly other AI characters. Mapping:

- **assistant** = THIS persona's own prior messages, and nothing else. (An assistant message is a first-person claim of authorship — other characters' words there would be self-attribution corruption.)
- **user** = everything else: every human (each message's content carries an attribution header) and OTHER characters' messages (attributed the same way — from this model's perspective, another character is just another interlocutor).
- **tool** = reserved; the persistence shape must round-trip `tool_calls`/`tool_call_id` when #4 lands (the converter's role-mapping fix is in scope now; storing tool turns is #4's).

**Per-message content format** (replaces the `<message from= role= t=>` XML attributes, which have no home on real messages):

```
[Name — 2026-07-05 14:32] message text…
```

Absolute timestamps only (kills the relative-drift poison); `<time_gap>` markers become a line in the next message's header zone. Image descriptions and hydrated references stay inline-enriched exactly as today. The current persona's own messages need no header (the assistant role IS the attribution) — but keep a minimal timestamp so time reasoning survives.

- **No merging of consecutive same-speaker messages** (resolved by fact-check): the current Anthropic Messages API auto-combines consecutive same-role turns server-side ("Consecutive `user` or `assistant` turns in your request will be combined into a single turn" — API ref, fetched 2026-07-05), so merging is not a compliance requirement anywhere in our provider set; keeping messages separate preserves Discord's rapid-fire rhythm/timing cues (council: they carry emotional-urgency signal) and finer cache-prefix granularity.
- **Participant roster reframing (council)**: the participants section explicitly declares in-scene names as fictional interlocutors, not operators — containing the instruction-authority a user-role message carries (an in-scene character saying "ignore your instructions" is dialogue, not a directive).
- **Structured metadata rides `additional_kwargs`** (council): each history message carries `{ speakerId, isAi, discordMessageId }` alongside the human-readable header — LangGraph routing and the memory architecture need machine-readable speaker identity; text headers are for the model, kwargs are for the machine.
- **Fidelity rule (council)**: history stores the model's RAW output (post-processing for Discord display never feeds back into the model's view of its own voice); truncated outputs get an explicit truncation marker so the model doesn't continue its own amputated thought. (Error-spoiler stripping before persist already follows this principle.)
- **Header-leakage guard (council)**: an S0 output-format rule forbids the model emitting attribution headers itself; the existing response-artifact stripping backstops it.

### 2.4 Replies (adapts the inline-`reply_to` idea to the new shape)

The parked idea targeted `<chat_log>` XML attributes; the shape changed, the principle survives: **reply context renders inline in the replying message, in compact quote form, only when the target is outside the history window** — in-window targets get a one-line pointer (`↩ replying to Name at 14:20: "first words…"`) since the full text is present in the array. `<contextual_references>` (V-tier, user message) carries only out-of-window resolved targets. This kills the double-rendering that caused the self-reply continuation risk (#1317's root cause) at the source. The ideas entry is absorbed by this doc.

### 2.5 Cache-aware history-window policy

Prefix caching means **dropping the oldest message invalidates everything after it** — a rolling window that slides every turn defeats breakpoint B perpetually. Policy: **chunked eviction with hysteresis** — when the history budget is exceeded, evict down to ~75% of budget in one cut (oldest-first, as today), then let the window refill. The prefix is then stable for many turns between slides; each slide costs one miss. Invariants (council): eviction cuts on message boundaries only; a **minimum-message floor** (never evict below N messages — a small budget must not strip the persona of scene context); tool-call/tool-result pairs evict **atomically** (an orphaned `tool_calls` without its result is a provider error — forward-compat invariant for #4). Note the average-context trade honestly: the window oscillates 75–100% of budget (vs a per-turn slider's constant 100%), i.e. slightly less average context bought for prefix stability — and any message lost to a chunk cut would have left the window within a few turns under sliding anyway. Epoch resets (`/history clear`), heal-on-read corrections, and message edits are accepted single-miss events (history is ephemeral by design — the cache must tolerate rewrites, never prevent them).

### 2.6 Reasoning-model rewrite: DELETED, not fixed (fact-check outcome)

The draft planned to fix the system→user rewrite with a `developer`-role message. Fact verification (2026-07-05, OpenAI first-party docs) dissolved the problem: **the entire o-series is deprecated** (o1 → o4-mini, all marked deprecated; current reasoning lineup is GPT-5.4/5.5 with effort levels) and **no current OpenAI model rejects the `system` role** — Chat Completions accepts both `system` and `developer` API-wide, with system treated as developer for reasoning models. The transform (`transformMessagesForReasoningModel` + the stale `/^(openai\/)?o[13]…/` gate) is dead code guarding against dead models, with destructive behavior (content-part flattening, silent system-content drops) as its only remaining effect. **Delete it** (Phase 0). Reasoning-effort config plumbing is unaffected and stays.

### 2.7 Provider-aware cache markers

**Owner constraint (2026-07-05): do NOT assume Anthropic.** Anthropic models are not in active use (too expensive without caching). Design consequence: the explicit-marker machinery is **Qwen-first** (Qwen routes are in real use and require `cache_control` via OpenRouter — same field, same content-part mechanics as the Anthropic rows), and the dominant real-traffic case is the automatic/implicit-caching providers (z.ai GLM, Kimi/Moonshot, DeepSeek, OpenAI, Gemini, free models), where prefix stability alone pays and there is no write-premium dilemma at all. Anthropic remains a supported-but-dormant row — and 0.1× cached reads are precisely what could make it affordable later; the design enables that option without assuming it.

All rows below are doc-verified 2026-07-05 (sources in §9):

| Provider route | Mechanism (verified) | Action |
| --- | --- | --- |
| Anthropic via OpenRouter | explicit `cache_control:{type:'ephemeral'}` on content parts — **officially documented pass-through** in OpenAI-format requests; max 4 breakpoints; `ttl:'1h'` supported (write 1.25× @5m / 2× @1h, read 0.1×; min cacheable 512–4,096 tokens by model, silently uncached below) | Markers at A + B. Phase-0 spike NARROWED to: does `ChatOpenAI`'s serializer preserve the field on content parts? (Fallback seam: `OpenRouterFetch` body rewrite) |
| **Qwen (Alibaba) via OpenRouter** | requires explicit `cache_control` (same as Anthropic) — new fact; we route Qwen models | Same markers as Anthropic rows |
| OpenAI / DeepSeek / Grok / Moonshot / Groq via OpenRouter | automatic (OpenAI reads 0.25–0.5×, no write cost; DeepSeek reads ~0.1×) | No markers — prefix stability alone pays |
| Gemini via OpenRouter | **implicit automatic** (Gemini 2.5+, default-on since 2025-05; ~90% cached-input discount per current Google pricing; no markers needed via OpenRouter) | No markers |
| z.ai direct (coding plan) | implicit automatic documented for the STANDARD endpoint (`usage.prompt_tokens_details.cached_tokens`, ~80% discount); **coding-plan endpoint undocumented** | Phase-0 empirical check: read the usage field off real coding-plan responses |

**Marker gating (council synthesis, adopted — applies to marker-requiring routes generally, Qwen today)**: breakpoint A always-on (small prefix — any write premium negligible); breakpoint B **activity-gated** — mark only when the conversation's last completion was within the cache TTL (one timestamp per conversation; telemetry then tunes or removes the gate). **Phase-0 addendum**: the fact sheet verified Qwen REQUIRES markers via OpenRouter but not its cache economics (write premium? TTL?) — verify before Phase 3 sizes the gate. Markers are **recomputed per attempt**: retry layer 2 rebuilds messages, layer 3 swaps providers entirely (auto-promotion fallback) — a cache decision never survives a provider swap.

**Invalidation semantics (council)**: S0 and S1 each carry a **version hash**; a persona edit changes S1's hash → the prefix changes → caches invalidate naturally, and in-flight conversations pick up the new persona on their next turn (no mid-scene reset). The prefix-diff tool (§2.8) reports divergence offsets against tier boundaries, so "divergence at S1" reads as "persona edit, expected" rather than mystery miss.

### 2.8 Telemetry (no measurement, no epic)

Every completion records the verified OpenRouter usage fields — `usage.prompt_tokens_details.cached_tokens`, `cache_write_tokens`, and `cache_discount` (z.ai standard exposes `cached_tokens` too) — into the diagnostic payload (and `/inspect`'s Model view — boulder #1 spec already adds sampling params there). A prefix-diff debug tool (compare consecutive requests' prefixes for a conversation, report first-divergence offset) turns "silent cache miss" into a diagnosable event. Baseline week before Phase-3 markers, comparison week after.

## 3. What gets deleted

- `<request_id>` buster (`PromptBuilder.ts:229`) — verify-and-remove (theme Phase 1; hypothesis: prefix caching affects billing, not sampling — repetition won't return; if it does, root-cause via sampling params, never re-add entropy).
- `historyReductionPercent` retry shrink (`ContentBudgetManager.ts:243`) — same verify-and-remove treatment, same rationale.
- Relative-timestamp suffixes inside history (absolute-only; §2.3).
- References duplication (§2.2) + `<contextual_references>` for in-window targets (§2.4).
- The o-series transform itself, entirely (§2.6) — dead code for dead models.

## 4. Token budgeting under the new shape

Allocation logic survives with container changes: base = S0+S1 (fixed, never truncated — as today); memory keeps the 25%-cap knapsack (drop-whole-by-relevance); history budget = remainder, with §2.5's chunked eviction replacing per-turn sliding. Counting now sums real messages (per-message overhead ~4 tokens/message on OpenAI-wire — budget must include it; ~100 messages ≈ 400 tokens, fine). `ContextWindowManager` keeps newest-first selection; the eviction cut is the only behavior change.

## 5. Compatibility & risk notes

- **Multi-party attribution regression risk** (the big one): moving speaker attribution from XML attributes to content headers + role assignment changes what models "see." Free/small models may attribute worse (or better — role separation is what they're trained on). Mitigation: snapshot-style prompt-diff review at each phase + the existing duplication/quality retry nets + staged rollout via a personality-level flag if needed.
- **Heal-on-read + epochs**: single-miss events, by design (§2.5). Never let caching create pressure to freeze history — the memory boulder (#3) owns history semantics and this design must not constrain it.
- **Multimodal**: content-parts arrays are the LangChain-native shape (VisionProcessor already builds them); the main path stays text-descriptions for now — but the section model must render into parts-arrays, not string-only, so images-inline (a #4-era option) and cache_control blocks have a home.
- **LangGraph adoption gate: passed by construction** — history as `BaseMessage[]`, system = instructions-only, tool_call pairing representable after the converter fix. `createAgent`+middleware (incl. `anthropicPromptCachingMiddleware`) become available options for #4, not requirements.
- **Cold-start economics**: Anthropic write premium is lost only when no follow-up lands within the 5-min TTL; activated-channel conversations (the dominant shape) are exactly the multi-turn-within-TTL case. Telemetry adjudicates.

## 6. Phasing

| Phase | Contents | Value gate |
| --- | --- | --- |
| **0 — spikes + deletions** | `ChatOpenAI` cache_control serialization spike (Qwen-first — OpenRouter side documented, same mechanics for the dormant Anthropic rows); Qwen cache-economics lookup (premium/TTL); z.ai coding-endpoint empirical cache check; verify-and-remove request_id + historyReductionPercent; **delete the o-series transform** (§2.6); cache telemetry fields | Anti-cache measures gone = automatic-prefix providers start hitting on the S0…S1 prefix the moment Phase 1 lands |
| **1 — typed sections + tier reorder** | Section model `{id, tier, render}`; S0/S1/V partition **within the current 2-message shape** (volatiles hoisted into the user message; absolute timestamps in chat_log); memory-block framing language (§2.2); **prefix-diff tool ships here** (council: it is the cache debugger, needed from the first restructure); **exit gate: 20–30-turn voice-consistency snapshot comparison across 3+ personas before Phase 2 may start** | Structural validation + a modest automatic-caching win (honest sizing, council: the system prefix is the small fraction of input; breakpoint B is the economic event) |
| **2 — history extraction** | `<chat_log>` → real messages (multi-party mapping §2.3, content headers + kwargs metadata, inline replies §2.4, chunked eviction + invariants §2.5, converter role fix) | The structural payoff: breakpoint B, LangGraph gate, tool-shape readiness |
| **3 — explicit markers + measurement** | Anthropic cache_control at A+B (per spike's chosen seam); telemetry dashboards; baseline-vs-after cost comparison | The cost win, quantified |
| **4 — layered S1 composition** | Layer seam already typed in Phase 1; channel layer + schema when its trigger fires | Deferred; design closed now |

Phases 0–1 are cheap and independently valuable. Phase 2 is the risk center (multi-party regression) — it gets the snapshot review + staged rollout.

## 7. Backlog absorption map (at landing)

- `provider-prompt-caching` theme → this doc supersedes its fix-shape; theme file points here, keeps telemetry/risk notes as requirement record.
- Layered-system-prompting follow-up (`follow-ups.md:105`) → §2.1 layer seam; entry annotated design-landed (schema work still trigger-gated).
- Inline-`reply_to` idea → §2.4 (adapted to real messages); entry annotated absorbed.
- NEW follow-up: `REASONING_MODEL_FORMATS.md` is stale on extraction mechanics (describes the removed transport-layer body mutation; actual: `__includeRawResponse` + `extractOpenRouterReasoning.ts` post-parse) — doc fix.

## 8. Open calls — post-council/post-verification status

| # | Call | Status |
| --- | --- | --- |
| 1 | Volatile tail inside current user message | **Council unanimous** + framing-language spec added (§2.2) — **CONFIRMED 2026-07-05** |
| 2 | Other characters as attributed user-role | **Council unanimous** + roster reframing added (§2.3) — **CONFIRMED 2026-07-05** |
| 3 | Merge consecutive same-speaker runs? | **RESOLVED by fact-check: no merge.** Anthropic auto-combines same-role turns server-side (compliance objection dead); separate messages preserve rhythm cues + cache granularity — **CONFIRMED 2026-07-05** |
| 4 | Eviction hysteresis size | **DECIDED 2026-07-05: 75% constant + minimum-message floor** (council split recorded: Qwen preferred 10% cuts, Kimi tunable; telemetry — turns-between-evictions — revisits) |
| 5 | Cache-marker gating | **Council synthesis adopted**: A always-on, B gated by last-completion-within-TTL (one timestamp per conversation); telemetry tunes — **CONFIRMED 2026-07-05** |
| 6 | Phase 1 standalone | **Council unanimous**, honest sizing + voice-consistency exit gate added (§6) — **CONFIRMED 2026-07-05** |
| 7 | o-series developer role | **DISSOLVED by fact-check**: o-series fully deprecated; no current OpenAI model rejects `system`; the transform is deleted outright (§2.6) |

## 9. Council pass + fact verification record (2026-07-05)

**Trio**: GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max (full roster per council skill). **Folded**: internal-recall framing + untrusted-content boundary (all three, independently — the design's most likely silent quality regression); participant-roster reframing; raw-output history fidelity + truncation markers; S0/S1 version-hash invalidation; `additional_kwargs` speaker metadata; tool-pair atomic eviction + min-floor + boundary-only cuts; header-leakage guard; Phase-1 honest sizing + exit gate; prefix-diff tool promoted to Phase 1; hybrid marker gating; per-provider verified capability matrix (§2.7).

**Rejected with evidence**: Kimi's "Anthropic requires strict alternation" (current API auto-combines — fetched 2026-07-05); Kimi's "storage migration needed for XML history" (history is DB rows; XML is render-time serialization); Kimi's "request_id served tracing" (nothing reads it; correlation IDs live in headers/logs); Kimi+GLM's "Gemini is explicit-cache-only" (true for direct API, moot via OpenRouter — implicit automatic, verified); Qwen's "use ChatAnthropic for Anthropic routes" (Anthropic is reached via OpenRouter on the OpenAI wire; the narrowed spike answers the real question); Qwen's "V-budget collision missed" (existing allocation order already computes current-message before history budget — preserved, §4).

**Noted, out of scope here**: concurrency/generation-queue model (existing behavior: per-message jobs re-assemble context at generation time, so interleaved messages ride the next turn — documented as the accepted model; LangGraph interrupt semantics are #4's topic); RAG-vs-history contradiction handling (memory boulder #3 owns it).

**Owner constraints on record**: do not assume Anthropic (not in active use; §2.7 reframed Qwen-first) · roleplay quality is load-bearing — caching wins never trade against it (Phase gates exist for this).

**Fact sheet** (verification agent, 2026-07-05, first-party docs; the user's staleness challenge triggered this pass and it dissolved §2.6 + resolved call 3): OpenAI current reasoning lineup GPT-5.4/5.5, o-series fully deprecated, `system` accepted API-wide · Anthropic 1.25×/2× write, 0.1× read, 4 breakpoints, 512–4,096 min, same-role auto-combine · OpenRouter cache_control pass-through documented (content parts, sticky routing; usage: `cached_tokens`/`cache_write_tokens`/`cache_discount`); Qwen also marker-required; OpenAI/DeepSeek/Grok/Moonshot/Groq automatic; Gemini implicit-automatic · z.ai implicit on standard endpoint, coding endpoint unverified (Phase-0 empirical check). Sources archived in the fact-sheet section of the session; key URLs: platform.claude.com/docs prompt-caching + messages API, openrouter.ai/docs/guides/best-practices/prompt-caching, developers.openai.com models/reasoning docs, ai.google.dev caching + pricing, api-docs.deepseek.com, docs.z.ai/guides/capabilities/cache.
