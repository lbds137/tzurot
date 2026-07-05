### Theme: Next-Gen AI Capabilities

_Focus: future AI features — agentic scaffolding and its tool consumers (web search/fetch, deep research, media generation), plus advanced prompt techniques._

#### Advanced Prompt Features

_SillyTavern-inspired prompt engineering._

- **Lorebooks / Sticky Context** - Keyword-triggered lore injection with TTL
- **Author's Note Depth Injection** - Insert notes at configurable depth in conversation
- **Dynamic Directive Injection** - Anti-sycophancy prompt techniques

#### Agentic Features

_Self-directed personality behaviors. The scaffolding is the boulder — everything below it registers as a tool once the loop exists (user framing 2026-07-03: agentic features BLOCK image/video generation and web tools)._

- **Agentic Scaffolding** — **DESIGN ACCEPTED 2026-07-05 (boulder #4)**: [`docs/proposals/backlog/agentic-scaffolding.md`](../../../docs/proposals/backlog/agentic-scaffolding.md) governs — hand-rolled loop on @langchain/core vocabulary (createAgent re-open triggers named), final-turn protocol, wall-clock budget, v1 tools = recall_memories → web_search → generate_image, toolsEnabled/toolSettings gating, ephemeral tool turns + history usage-note, transcript → /inspect. The design hazards this entry tracked (hallucinated tool XML, real-vs-fake intent, pipeline-seam fragility, contract-suite prerequisite) are all disposed in the artifact (§3.5 landmines, Phase 0). Implementation phases pull from artifact §5.
- **Web search tool** — artifact Phase 1 (`openrouter:web_search` server tool; execution-locus spike in Phase 0)
- **Web page fetch tool** - fetch a link the user shared so the character can read it. **User-agent policy (user decision 2026-07-03)**: use a browser-like user agent that passes AI blockers — these fetches are USER-INITIATED (a person asking a character to look at a link they shared is one step removed from that person visiting the page themselves), not autonomous crawling. Boundary: only fetch on explicit user request; SSRF rules from `00-critical.md` apply (encode all dynamic URL parts, validate schemes).
- **Deep research agent (user request 2026-07-03)** - a character acting as a multi-step research agent (plan → search → read → synthesize → cite), the way OpenAI / Anthropic / Google ship "deep research" today. **Distinct from the two single-shot web tools above** — this is a bounded sub-agent loop (many searches + fetches + reasoning over minutes), NOT one lookup, so it needs its own handling: long-running-job semantics well past Discord's window (progress updates, cancellation), an iteration/cost budget, and source-citation output. **Method (REQUIRED before design)**: research the state of the art — how the major providers structure deep-research loops, what's become the industry-standard shape — and align with it rather than inventing our own. Sits on top of the agentic scaffolding (it IS the scaffolding's most demanding consumer); a candidate boulder-design input, not a quick add.
- **Dream Sequences** - Self-reflection and memory consolidation
- **Relationship Graphs** - Track relationships between users and personalities

#### Multi-Modality

_Beyond text: voice and images. Gated on agentic scaffolding (media generation = a tool the loop calls)._

- **Image Generation** — artifact Phase 2 (`generate_image` local tool, tool-only surface, caps + in-voice moderation recovery)
- **Video Generation** - same tool-registration shape as image generation once the loop exists
