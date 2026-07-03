### Theme: Next-Gen AI Capabilities

_Future features: agentic behavior, multi-modality, advanced prompts._

#### Advanced Prompt Features

_SillyTavern-inspired prompt engineering._

- **Lorebooks / Sticky Context** - Keyword-triggered lore injection with TTL
- **Author's Note Depth Injection** - Insert notes at configurable depth in conversation
- **Dynamic Directive Injection** - Anti-sycophancy prompt techniques

#### Agentic Features

_Self-directed personality behaviors. The scaffolding is the boulder — everything below it registers as a tool once the loop exists (user framing 2026-07-03: agentic features BLOCK image/video generation and web tools)._

- **Agentic Scaffolding** - Think → Act → Observe loop inside the BullMQ generation pipeline (iteration budgets, per-tool timeouts, partial-progress vs Discord's patience). Design hazards already known: hallucinated tool-use XML is documented on GLM-4.5-Air specifically (newer GLM models are expected to be better — verify per model at design time); the family-wide pattern is reasoning-TAG vocabulary leaks (see `glm-family-quirks` memory), so real-vs-fake tool intent still needs per-model adjudication on the roster's weaker models; the pipeline seam is the most regression-prone in the codebase — the job-payload contract suite (deterministic test-quality theme) is a de-facto prerequisite safety net.
- **Web search tool** - user-initiated lookups from within character conversations
- **Web page fetch tool** - fetch a link the user shared so the character can read it. **User-agent policy (user decision 2026-07-03)**: use a browser-like user agent that passes AI blockers — these fetches are USER-INITIATED (a person asking a character to look at a link they shared is one step removed from that person visiting the page themselves), not autonomous crawling. Boundary: only fetch on explicit user request; SSRF rules from `00-critical.md` apply (encode all dynamic URL parts, validate schemes).
- **Deep research agent (user request 2026-07-03)** - a character acting as a multi-step research agent (plan → search → read → synthesize → cite), the way OpenAI / Anthropic / Google ship "deep research" today. **Distinct from the two single-shot web tools above** — this is a bounded sub-agent loop (many searches + fetches + reasoning over minutes), NOT one lookup, so it needs its own handling: long-running-job semantics well past Discord's window (progress updates, cancellation), an iteration/cost budget, and source-citation output. **Method (REQUIRED before design)**: research the state of the art — how the major providers structure deep-research loops, what's become the industry-standard shape — and align with it rather than inventing our own. Sits on top of the agentic scaffolding (it IS the scaffolding's most demanding consumer); a candidate boulder-design input, not a quick add.
- **Research-agent mode** (user request 2026-07-03) - users ask a character to conduct multi-step research (deep-research class: iterative search → fetch → synthesize → cited report), distinct from single web-tool calls. **Needs separate handling from the basic loop** — longer-running than a chat turn (progress UX, probably its own job shape vs. chat generation), budget caps, and citation/synthesis conventions. **Research-first (REQUIRED, act
- **Dream Sequences** - Self-reflection and memory consolidation
- **Relationship Graphs** - Track relationships between users and personalities

#### Multi-Modality

_Beyond text: voice and images. Gated on agentic scaffolding (media generation = a tool the loop calls)._

- **Image Generation** - AI-generated images from personalities
- **Video Generation** - same tool-registration shape as image generation once the loop exists
