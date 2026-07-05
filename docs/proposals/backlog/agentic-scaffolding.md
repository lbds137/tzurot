# Agentic Scaffolding — Tool Loop Design

> **Status**: ACCEPTED 2026-07-05 (boulder #4) — trio council pass folded (§8); all §7 calls confirmed by owner 2026-07-05
> **Adjudication**: own the loop, use their vocabulary (§1). createAgent re-open triggers named.
> **Upstream deps**: boulder #2's message shape (BaseMessage[], tool-pairing representable) is the enabling substrate; boulder #3's memory design consumes/feeds via the recall tool (later phase); the **job-payload contract suite is the prerequisite build** (confirmed specced, not built — fast-check over legacy/envelope shapes, motivated by #1184).
> **Grounding** (2026-07-05): LangChain 2026 stack deep-dive (createAgent API/middleware/Deep Agents/stability — the owner's LangGraph directive) · tool-calling + tool-backend landscape (live OpenRouter /models pull + z.ai docs) · pipeline-seam map (insertion point, landmines, budgets, gating patterns).

## 1. The adjudication: hand-roll the loop core, LangChain-primitives-native

**Verdict: own the loop (honestly sized: 150–250 lines with edge cases), built on `@langchain/core` vocabulary (`tool()` + zod, `ToolMessage`, `AIMessage.tool_calls`), NOT on `createAgent`'s graph.** Both options were live — the deep-dive verified createAgent runs stateless (no checkpointer, external messages array, zero new packages, API stable since 1.0). What decides it:

1. **Invocation-hardening reuse** (decisive): our per-call stack — `invokeWithRetry` with rate-limit/credit short-circuit caches, `parseApiError` classification, `finish_reason:'error'` handling, thinking extraction — wraps a single `invoke()`. A hand-rolled loop calls that stack **unchanged per iteration**. createAgent puts its loop inside that boundary, requiring the hardening be ported into `wrapModelCall`/`modelRetryMiddleware` — real work, real risk, two retry layers.
2. **The quality-retry × side-effects problem** (structural): `generateWithDuplicateRetry` re-runs generation on duplicate/leaked-CoT/empty results. With tools, naive re-run = **re-executing side-effectful tools** (an image billed 3×). The rule this design sets — *quality retries re-run only the final synthesis call, with tool results held fixed* — is trivially expressible in an owned loop and awkward through a compiled Pregel graph that re-runs from the top.
3. **What we give up is small and recoverable**: error→ToolMessage conversion (semantics copied from ToolNode's `"${error}\n Please fix your mistakes."` pattern), `Promise.all` parallel execution, cap-exhaustion messaging, progress hooks. Tool-call *parsing* and tool *definition* come free from `@langchain/core` either way — the delta is orchestration only. **Honest sizing (council, all three)**: not ~80 lines — 150–250 with the edge cases (strict `tool_call_id` 1:1 mapping under partial timeouts, hallucinated-name handling, final-turn protocol, wall-clock budget). Still tractable; the Phase-1 test plan explicitly covers partial `Promise.all` failures and malformed tool-call arrays.
4. **Adoption stays one contained swap away**: boulder #2 made our message shape LangGraph-native; tools defined with `tool()`+zod are createAgent's own currency. **Re-open triggers**: (a) the deep-research/subagents phase arrives (`createSubAgentMiddleware`/`createFilesystemMiddleware` are exported from langchain itself — à la carte, no deepagents dependency), (b) the owned loop accretes a third middleware-equivalent feature (summarization, HITL, PII…), (c) langchain 2.0 lands with a migration story worth riding.

**Provider seam: stays thin — confirmed** (the agenda's conditional resolves to NO abstraction). OpenRouter normalizes the OpenAI tool wire across all our families; z.ai-direct speaks the same dialect. Three shims, not an adapter layer (§3.4).

## 2. Scope: what a tool loop is for HERE

Roleplay-native framing: tools let a character **do things mid-scene** — look something up, produce a picture, dig through their own memories — without breaking voice. Not an autonomous agent; a bounded think→act→answer loop inside one reply generation.

**v1 tool set (council-restructured)**:

1. **`recall_memories`** (Phase 1's loop-exerciser — promoted from later phases per council's "don't battle-test the loop on chaotic web search"): a thin local tool over the EXISTING `MemoryRetriever` (query arg → deeper/targeted retrieval than the automatic RAG pass). Free, side-effect-less, injection-proof, deterministic-ish — the perfect tool to prove the loop mechanics — and it's the boulder-#3 seam arriving early.
2. **`web_search`** (OpenRouter server tool `openrouter:web_search`, ~$0.005/req Exa; z.ai-direct native `web_search` equivalent). **Phase-0 spike must determine the execution locus**: if OpenRouter executes server tools provider-side within one completion, this ships as near-free passthrough that never touches our loop; if results round-trip through the client, it's a normal tool in the loop. Either way it lands in Phase 1.
3. **`generate_image`** (Phase 2): a LOCAL function tool whose execute() calls OpenRouter image generation (dedicated `/api/v1/images` or a modalities-capable model) — necessarily local, because the character's own chat model (GLM/Kimi/etc.) can't emit images; base64 → Discord attachment; the dormant `imageEnabled`/`imageSettings` fields get their consumer.

Later phases: lore lookup, deep research (re-open trigger a).

## 3. Design

### 3.1 The loop (inside the existing pipeline — no new job types)

Lives in `ConversationalRAGService` wrapping today's single `invokeModelAndClean` (between orchestration steps 6 and 7; the seam the pipeline map identified):

```
messages = [system, ...history, user+volatile]          // boulder-#2 shape
budget = WALL_CLOCK_BUDGET                               // council: global guard, checked pre-iteration
for i in 1..TOOL_LOOP_MAX (v1: 3):
  isFinal = (i == TOOL_LOOP_MAX) || budget.low()
  response = llmInvoker.invokeWithRetry(messages, { tools: isFinal ? NONE : allowedTools })
  if no response.tool_calls: break                       // final answer
  results = mapWithIds(tool_calls, execute)              // strict tool_call_id 1:1; try/catch → ToolMessage
  messages += [assistantMsgWithToolCalls(+reasoning_details), ...toolMessages]
  emit progress(tool names)                              // §3.6
```

**Final-turn protocol (council catch — the draft's cap-out path was a wire-contract violation)**: the last permitted iteration offers NO tools, so it cannot end with unfulfilled `tool_calls`; if a model somehow emits tool calls on a no-tools turn, they're answered with terse error ToolMessages and one more forced synthesis, else fail closed to the catalog error path. An assistant message with `tool_calls` is ALWAYS followed by matching ToolMessages — invariant, tested.

- **Quality-retry rule (council-refined)**: structural-validation failure of a tool-CALL generation (garbled ids, invalid args JSON) retries THAT generation — safe, nothing executed yet; tool EXECUTIONS run at most once per generation (idempotency keys on side-effectful tools as belt-and-braces); duplicate/leaked-CoT quality retries re-run ONLY the final synthesis with tool results pinned.
- **Hallucinated-call handling (council)**: unknown tool name → terse ToolMessage ("that tool isn't available"), max 1 such recovery per loop then forced synthesis; zod arg-validation failures produce clean text, never stack traces.
- **Tool-result context management (council)**: `truncateToolResult(result, maxTokens)` before appending (web results can run 5–15k tokens — two searches could smash the window); base64 image payloads NEVER re-enter the prompt — uploaded to Discord immediately, the ToolMessage carries a short reference/summary instead (also keeps BullMQ/Redis job state lean).
- **Timeouts compose with existing budgets**: global wall-clock budget checked before each iteration (exhausted → straight to the no-tools synthesis turn); per-tool timeouts v1: 30s web / **45s image** (council: 90s let a hung request eat half an attempt budget); max 1 concurrent image execution per loop; `TOOL_LOOP_MAX=3` keeps worst case inside existing envelopes and the ~5min UX budget. No timeout constants change.
- **Tool-turn persistence (council-refined — the amnesia problem)**: raw tool turns stay ephemeral, BUT the persisted history row carries a **compact tool-usage note** (metadata rendered as a small bracketed line, like time-gap markers: `[searched: "X" · generated image]`) so the next turn can answer "tell me more about what you found" / "make it darker" without hallucinating how it knew things. Generated images persist as normal Discord attachments — the existing attachment-description enrichment gives the next turn their content automatically. The full transcript rides the EXISTING diagnostic payload → `llm_diagnostic_logs` (24h retention, per-user access control already solved — simpler than the council's suggested new Redis store) → `/inspect` gains a **Tools view** (calls, args, truncated results, per-call latency/cost incl. retries).

### 3.2 Tool registry

`tool()` + zod schemas in a small registry: `{ name, description, schema, execute(args, ctx), permission: (auth, personality) => boolean, timeoutMs, costClass }`. Server-side tools (`openrouter:web_search`) pass through as-is in the tools array — no local execute. Registry is the seam boulder #4's later phases (memory recall, lore) plug into.

### 3.3 Permissioning + cost caps

- **Carrier**: `allowedTools` resolved in `AuthStep` onto `ResolvedAuth` (the pipeline-native gating pattern; mirrors `applyGuestModeOverrides`).
- **v1 policy**: guests get **no tools** (free-model tool support flaky — no `:free` GLM/Kimi/DeepSeek exist anymore; cost exposure); BYOK users get tools where the resolved model supports them; per-personality: `imageEnabled` gates `generate_image` (existing column, finally real), a new `webSearchEnabled` (or a `toolsEnabled` umbrella — owner call §7) gates search; `imageSettings` carries image model/size/caps.
- **Caps**: loop cap 3 (stored in `toolSettings` so it's per-personality tunable later — council); per-user per-day caps for BOTH images AND web searches (council: unbounded $0.005s still add up); total cost incl. retries in diagnostics; image cost surfaced in the reply footer; tool spend in ops:health (boulder-#3's cost-guardrail discipline applies).

### 3.4 Provider shims (all three verified)

1. **Capability gate**: model's `supported_parameters` must include `tools` before the array is sent (hard 404 otherwise, not silent ignore); source = `OpenRouterModelCache` (already caches /models; gains supported_parameters) + static allowlist for z.ai-direct. Tools silently omitted (with a diagnostic note) for non-capable models — the personality still replies, just tool-less.
2. **Reasoning round-tripper**: loop-internal assistant messages echo `reasoning_details` (OpenRouter) / `reasoning_content` (z.ai) back unmodified — **mandatory for Kimi K2.5+** (hard error without it), harmless elsewhere. Critically: this is the API-level message layer — the display-side thinking-extraction machinery keeps stripping reasoning from *final rendered content* only, never from loop-internal messages. Phase-0 spike verifies ChatOpenAI surfaces these fields round-trippably (the `__includeRawResponse` seam exists).
3. **Every-request tools invariant** + `tool_choice` never forced (z.ai supports `auto` only).

### 3.5 Landmine reconciliation (from the seam map)

- `LLMInvoker.contentToText` flattens non-text parts → must preserve `tool_calls` on the response object through extraction/cleaning.
- `responseArtifacts.ts` strips hallucinated `<tool_calls>` XML → becomes conditional: strip only when tools were NOT offered in the request (when offered, real tool intent arrives structured, and content-embedded XML is still fake — but the strip must not fire on legitimate mixed content; exact rule at implementation with tests).
- Weak-model fake-tool-intent (the backlog's flagged problem): models without tool support hallucinating tool syntax stays handled by the existing strip; models WITH tools that emit malformed calls get the error→ToolMessage self-correction path.

### 3.6 In-scene progress (design hook, minimal v1)

`JobTracker` already holds the channel message handle (the "taking longer" notice). v1: when a tool executes, ai-worker publishes a lightweight progress event (new Redis pub/sub channel — the cache-invalidation pattern reused); bot-client edits/creates one italic status line (`🔍 *searching the web…*`, `🎨 *painting…*`), deleted on delivery like `takingLongerMessage`. Wording from the boulder-#1 message catalog; per-persona flavored phrasing is a later delight, the hook is designed now. Fallback if the pub/sub plumbing slips a phase: no progress line, typing indicator carries v1 (it already runs).

### 3.7 Safety

- **Tool results are untrusted content**: web results render into the loop wrapped in the boulder-#2/#3 untrusted-content boundary framing (instructions in fetched pages are data, not directives).
- **Image-gen policy**: provider-side moderation is the backstop; `imageEnabled` is per-personality owner control; generated images ride Discord's own channel NSFW rules. Guests: no image gen (no tools at all, v1). **Injection→image bridge closed (council)**: the image tool's description states web content can never request images — only the character's own judgment triggers generation. **Moderation-refusal recovery (council)**: a blocked image returns an error ToolMessage; the synthesis instruction handles it in-voice (the character deflects naturally), never leaking "safety guidelines" verbiage into the scene; catalog system-line as last-resort fallback.
- **In-character containment**: the character narrates outcomes, never the tool mechanics (prompt-side instruction in the S0 tier; the tool transcript is `/inspect`-only).

## 4. Deliberately NOT doing (v1)

createAgent/deepagents adoption (triggers §1.4) · autonomous multi-step agents/planning · tool turns persisted to history · streaming tokens · MCP client support (nothing to connect it to yet; registry design doesn't preclude it) · forced tool_choice (z.ai can't) · structured-output + tools combined in one request (per-family behavior unverified — smoke-test before ever relying) · provider abstraction layer (3rd-provider trigger unchanged).

## 5. Phasing

| Phase | Contents | Gate |
| --- | --- | --- |
| **0 — prerequisite + shims** | Job-payload contract suite (the specced fast-check build — its own work item, Opus-suitable); capability-gate plumbing (`supported_parameters` into OpenRouterModelCache — incl. modalities + parallel-call support, council); reasoning round-trip spike; **server-tool execution-locus spike** (§2.2); contentToText + responseArtifacts reconciliation; wall-clock budget + final-turn protocol specced with tests; transcript-into-diagnostics plumbing; jobs.ts schema extension (version bump) | Contract suite green; round-trip spike verified on Kimi + GLM |
| **1 — loop core + recall_memories + web_search** | ToolLoop in RAGService (final-turn protocol, wall-clock guard, id-mapping, hallucination handling, truncation, synthesis-only quality-retry); registry; `allowedTools` gating + per-user daily caps (web too); `recall_memories` as the loop-exerciser; `web_search` per spike outcome; `/inspect` Tools view; cost telemetry incl. retries | Goldens: recall tool round-trip in voice on GLM + Kimi (thinking round-trip proven); partial-failure + malformed-array tests green; non-capable model degrades gracefully |
| **2 — progress line + image generation** | (2a) Redis pub/sub progress events + bot-client status-line edit, catalog wording — council: images are the latency driver, the progress line ships WITH them, not after; (2b) `generate_image` local tool; `imageEnabled`/`toolSettings` semantics + settings UX; immediate-upload + reference-substitution; caps + cost footer; moderation-refusal in-voice recovery | Image lands as attachment; caps enforced; quality-retry never double-bills; visible "painting…" during generation |
| **3 — expansion (each re-adjudicated)** | lore lookup · PDF file-parser plugin · deep research (re-open trigger: createAgent/subagent middleware à la carte; **interface contract pre-committed**: subagent-shaped tools run as child jobs on the DependencyStep/FlowProducer substrate — one paragraph, not a design) | Per-phase plan-mode + council |

## 6. Absorption / wiring map (at landing)

`next-gen-ai-capabilities` theme → this artifact governs the tool-loop portion (media gen + web tools were its named features); contract-suite item stays where it is (prerequisite pointer added); provider-abstraction ideas entry unchanged (trigger not fired — seam confirmed thin); `imageSettings` dormant-field disposition resolved here (Phase 2); responseArtifacts + contentToText reconciliation filed as Phase-0 work items in the theme.

## 7. Open calls — post-council status

| # | Call | Status |
| --- | --- | --- |
| 1 | Tool gating shape | **Council unanimous**: `toolsEnabled` umbrella + `toolSettings` JSONB (zod-schema'd — "not a junk drawer"), matches voiceSettings; per-tool columns = migration per tool. `imageEnabled` folds in — **CONFIRMED 2026-07-05** |
| 2 | Loop cap | **Council unanimous**: 3 — WITH the wall-clock guard (without it "3 is dangerous"), stored in toolSettings for per-personality tuning later — **CONFIRMED 2026-07-05** |
| 3 | Guest tools | **Council unanimous**: none v1 (flaky free-model support, abuse vector, hard-404 risk); revisit with verified capable free models + rate limits — **CONFIRMED 2026-07-05** |
| 4 | Image-gen surface | **Council unanimous**: tool-only — "a /image command turns the RP bot into a generic Midjourney wrapper"; if ever added, it routes through the same loop as an OOC prompt, never a separate pipeline — **CONFIRMED 2026-07-05** |
| 5 | Progress line | **Council split (2 Phase-3 / 1 Phase-1) → synthesized**: ships as Phase 2a, bundled BEFORE image gen (the latency driver that actually needs it); Phase 1 runs on typing indicator; GLM's empirical escape hatch stands (if Phase-1 loops exceed ~20s visible silence routinely, pull it forward) — **CONFIRMED 2026-07-05** |
| 6 | Deep research | **Council 2-1 + compromise**: Phase 3 behind the re-open trigger; Kimi's interface-contract concern honored with one pre-commitment line (subagent-shaped tools = child jobs on the existing FlowProducer substrate), no design — **CONFIRMED 2026-07-05** |
| 7 | **NEW: Phase-1 tool restructure** | recall_memories promoted to first loop-exerciser (free/safe/deterministic, boulder-#3 seam early); web_search execution-locus spiked in Phase 0 — **CONFIRMED 2026-07-05** |

## 8. Council + verification record (2026-07-05)

**Trio**: GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max — **all three accept the hand-roll adjudication** (GLM: "the reasoning is sound"; the quality-retry × side-effects argument called decisive). **Corrections adopted**: the final-turn protocol (Kimi's catch — the draft's cap-out path violated the tool wire contract: unfulfilled tool_calls in transcript); global wall-clock budget with pre-iteration checks (GLM+Qwen); honest 150–250-line sizing (all three); tool-result truncation + base64-never-re-enters-prompt (Kimi+Qwen); the amnesia fix — compact tool-usage note persisted in history metadata (Qwen: fully-ephemeral turns break "make it darker" follow-ups); quality-retry extended to structurally-invalid tool-call generations (Kimi); hallucinated-call spec + strict id-mapping tests (GLM+Qwen); image timeout 90→45s + 1-concurrent-image cap (GLM); per-user web-search daily cap (GLM); injection→image bridge rule + moderation-refusal in-voice recovery (GLM+Qwen); transcript retention resolved via EXISTING diagnostics infra (simpler than council's new-Redis suggestion — 24h retention + per-user access control already built); progress line re-sequenced ahead of image gen (Kimi's argument won the split's substance); recall_memories as Phase-1 exerciser (Qwen's battle-test concern, answered with a tool we already wanted).

**Noted, disposed**: /inspect privacy (already per-user filtered + redaction-layered — existing model covers it); Qwen's fictional-intent search-refusal concern → one line in the untrusted-results framing (results are reference material; the character's judgment governs); Kimi's parallel-batch latency note (sequential-when-dependent is the model's call via tool descriptions; not enforced v1).
