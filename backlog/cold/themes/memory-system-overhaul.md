### Theme: Memory System Overhaul

_Focus: replace verbatim-storage memory with summarized LTM, unify the two coexisting memory formats, and migrate to the OpenMemory waypoint-graph architecture — plus knowledge-scope RAG (lore books) and retrieval-quality work._

_Dependency chain: Configuration Consolidation → LTM Summarization → Table Migration → OpenMemory_

Design inputs from elsewhere: message-action affordances' history/memory consistency invariant (`user-requested-features.md`); prior command-design work in the `MEMORY_MANAGEMENT_COMMANDS.md` proposal — check before re-deriving.

#### 1. ✨ LTM Summarization (Shapes.inc Style)

Verbatim conversation storage is redundant with extended context. Replace with LLM-generated summaries.

- [ ] Configurable grouping (5, 10, 50 messages or 1h, 4h, 24h time windows)
- [ ] Separate LLM call for summarization (fast/cheap model)
- [ ] Store summaries as LTM instead of verbatim turns
- [ ] Per-personality opt-in (summarization toggle + summarizer LLM-config reference; some personas want verbatim)
- [ ] Summarizer prompt is a config surface (default strips roleplay formatting, preserves facts/names/dates; per-personality override)
- [ ] Consider hybrid storage (summary for embedding/search + verbatim for reference) before committing to lossy-only

_(Schema groundwork already shipped: `Memory.isSummarized`/`originalMessageCount`/`summarizedAt`.)_

#### 2. 🏗️ Memories Table Migration

Two formats coexist (shapes.inc imports vs tzurot-v3 verbatim). Need unified format.

- [ ] Design unified memory format (draw from both sources)
- [ ] One-time migration of existing tzurot-v3 memories
- [ ] Run existing verbatim memories through summarizer

#### 3. 🏗️ OpenMemory Migration

Waypoint graph architecture with multi-sector storage. (Distilled from the 1,115-line 2025-11 migration plan, deleted 2026-07 — full phase plan in git history; **re-derive config against current OpenMemory upstream before execution**, its env-var reference had already drifted.)

**What OpenMemory is**: multi-sector memory (episodic/semantic/emotional/procedural/reflective) with sector-specific decay; waypoint graph with associative propagation/strengthening/decay; hybrid scoring (~60% similarity / 20% token overlap / 15% waypoints / 5% recency); adaptive query expansion below ~0.55 confidence; retrieval-reinforcement learning.

**The decisive 2025-11 finding**: reflection/consolidation is 100% deterministic (cosine clustering, NO LLM) → zero NSFW-censorship risk — the key reason it beat LLM-based consolidation (Venice Uncensored was evaluated and dropped as unnecessary). Deep-analysis verdict: "genuinely sophisticated, proceed with high confidence."

**Locked decisions (2025-11-05 — revalidate at pickup)**: deep tier; `text-embedding-3-large` via OpenRouter's OpenAI-compatible `/v1/embeddings`; daily decay (REM-sleep framing); separate Railway service + separate Postgres DB; all-in cutover with no pgvector fallback.

**Key risks**: dev/prod memory-parity loss (needs a seed-data strategy — db-sync won't cover it); 2–5× embedding cost from multi-vector storage; HTTP-hop latency (use Railway private networking); sector-classification regexes may need forking for RP content (`sector_override` is the escape hatch).

- [ ] Re-derive deployment config from current OpenMemory upstream
- [ ] Design migration path from current flat memories (incl. dev/prod seed strategy)

#### 🏗️ Per-User Quotas

No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

#### 🏗️ Contrastive Retrieval for RAG

Improve memory retrieval quality with contrastive methods.

#### 🏗️ Knowledge vs Memory Distinction + Lore Books (user-loadable knowledge RAG)

Distinguish user-specific memories from personality-wide knowledge (lore, backstory, reference material). Add `type`/`scope` fields, support personality-wide knowledge items not filtered by userId. See [`docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md`](../../../docs/proposals/backlog/MEMORY_INGESTION_IMPROVEMENTS.md) for the full proposal (concepts valid, implementation TBD; originally drafted under the pgvector architecture).

**Lore books (user request 2026-07-03)**: user-facing document upload → chunk → embed → retrieve as knowledge-scope RAG. The user loads documents (world lore, character backstory, reference texts) into a character's or their own knowledge store; retrieval joins the normal memory RAG at generation time under the knowledge scope. SillyTavern's lorebooks/world-info (keyword triggers + logic gates — see `docs/research/sillytavern-features.md`) are prior art for the retrieval-trigger side; the ingestion side is new. **This is a named workstream of the overhaul design pass** — the storage decision (OpenMemory sectors vs pgvector scope column) must account for it.

#### ✨ Cross-channel history — smarter retrieval with limits

Limit messages per channel, prioritize channels with active conversations. Distinct from the user-driven `/history range` import (tracked in Inbox) — this one is about the automatic retrieval path that assembles context at generation time.
