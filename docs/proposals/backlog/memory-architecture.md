# Memory Architecture — Adjudication & Design

> **Status**: ACCEPTED 2026-07-05 (boulder #3) — trio council pass folded (§9); all §8 calls decided (owner sign-off 2026-07-05: fiction flag = scope+markers canonical with zero-cost LLM mismatch-flagging; all recommendations adopted)
> **Adjudication**: evolve the in-house pgvector system with named paradigm imports (§1). Runner-up documented with re-open triggers.
> **Upstream deps**: conforms to the prompt-assembly design (boulder #2 — memories render in the V-tier with internal-recall framing; history↔memory seam respects the message shape). Boulder #4 (agentic) consumes this design's retrieval as tools.
> **Grounding** (2026-07-05): OpenMemory rewrite dissection · 2026 landscape survey (8 systems + roleplay ecosystem) · current-impl map · prior-doc mining (2025-12 icebox) · owner's scoping model (canonScope/sessionId original intent) · owner's 9 curated links (memU, MRAgent cost data, Claude Code 7-layer teardown, context-graph-lite, pgvector hybrid techniques, automem, self-organizing-memory tutorial).

## 1. The adjudication

**Verdict: evolve in-house on Postgres+pgvector, importing named paradigms.** The evidence converged from five independent directions:

1. **LangChain's own 2026 JS position** ships a Postgres-backed semantically-searchable Store primitive and deliberately NO extraction/consolidation system — the ecosystem expects custom memory logic exactly where our pgvector system already sits. LangGraph adoption (#4) needs no memory framework.
2. **The paradigm poster child retreated**: mem0 v2.0 abandoned its LLM update-loop (ADD-only + retrieval-time reconciliation); 2026 research backs verbatim-over-extracted. OpenMemory's rewrite retired its own "brain-flavored" mechanics for boring durable explicit semantics. The clever versions got walked back by their authors.
3. **Cost reality** (owner's links): research-grade frameworks run 118k (MRAgent) to 3.26M (LangMem) tokens per query on LongMemEval — a 27× spread, all categorically over budget for per-message Discord roleplay on a BYOK/cost-conscious stack.
4. **The SOTA production counter-example**: Claude Code's memory is a hand-rolled, tiered, cheapest-first pipeline (tool-result pruning → session notes → compaction → extraction → offline dreaming), not an adopted framework.
5. **The two layers roleplay actually needs are custom everywhere**: the fiction/reality split (in-character canon vs true user facts) and the owner's social-scoping model (§2.2) exist in NO framework. Whatever we adopted, the distinctive half would still be built by hand.

**Evidence weighting (council-adjusted)**: pillars 1 (ecosystem position — fact-verified: langchain-js 1.5.2 + Store docs are SHIPPED, two council models wrongly called this unreleased), 5 (custom-everywhere layers), and 2 (authors retreating from cleverness) are primary; pillars 3 (benchmark costs — LongMemEval is an adversarial harness, not our per-message path; the honest comparison is async-extraction cost vs reply cost, budgeted in §3.8) and 4 (Claude Code — team-scale precedent, illustrative not probative) are contextual color.

**Fallback order (council)**: if the in-house path stalls, the FIRST response is **scope reduction** (drop community pools/canon groups/consolidation depth; keep integrity + hybrid retrieval + light extraction) — the sidecar adoption (below) is the second resort, not the first.

**Runner-up: Hindsight** (MIT, very alive, typed memories world-fact/experience/mental-model, 4-strategy retrieval + rerank, temporal + entity graph inside Postgres/pgvector) — as a Python sidecar service, a shape we already operate (voice-engine). **Re-open triggers (operationalized per council — measured on the §3.9 goldens, not vibes)**: (a) two consecutive phases fail their golden-scenario gates (>20% golden failures), (b) extraction hallucination rate >5% on a 100-sample golden eval after tuning, (c) memory-pipeline cost exceeds its §3.8 tripwire for 3+ consecutive weeks, (d) maintainer time on memory-specific bugs exceeds a sustained threshold. Scope reduction (above) is attempted before any trigger fires the sidecar path. Honorable candidate memU (Apache-2.0, pgvector-native, memory-as-compiled-workspace) — same sidecar shape, younger paradigm; noted, not selected. mem0-TS rejected: paradigm weakest for roleplay texture (fact-flattening) + TS/Python parity risk. Graphiti (graph DB drag), Letta (runtime adoption + mid-restructure), LangMem (stalled, Python-only), cognee (document-oriented), automem (Qdrant drag, weak provenance): rejected on constraints.

## 2. Requirements (roleplay-native)

Roleplay memory ≠ assistant memory: emotional/relationship continuity and character-consistent recall outrank task-fact accuracy.

### 2.1 Core (from grounding + prior icebox)

- **R1 Episodic callbacks with verbatim texture** — "that joke three months ago" needs the wording, not a fact about it. Verbatim episodes stay first-class (the current raw-pair storage is accidentally RIGHT about this; what's missing is everything around it).
- **R2 Relationship memory as versioned state** — trusted → betrayed → reconciled must be queryable as current-value-plus-history, not a pile of contradictory hits.
- **R3 Persona voice continuity** — slowly-evolving always-in-context state, not retrieval-dependent.
- **R4 Facts vs vibes** (2025 icebox, vindicated by the survey): typed memories with different retention/consolidation policies for hard facts vs emotional texture.
- **R5 Consolidation offline, never on the hot path** ("sleeping on it", 2025 icebox = Letta sleep-time = Claude Code dreaming).
- **R6 User curation as a first-class tier**: lore books (absorbed commitment), pins (generalize `isLocked`), edit/delete — auto-extraction proposes, the user can always overrule.
- **R7 Fiction/reality split**: in-character canon vs true-user-facts, never conflated.
- **R8 Integrity**: deletion means deletion (visibility filter — prod fix already filed), edits re-embed, memories link to source messages (populate `messageIds`), message-actions propagation policy, db-sync deletion propagation (absorbed commitment).
- **R9 Cost/latency discipline**: no LLM in the retrieval path; extraction async; consolidation scheduled; local embeddings stay.

### 2.2 The social scoping matrix (owner's model, 2026-07-05 — the original `canonScope`/`sessionId` intent, now designed for real)

| Dimension | Meaning | Pool semantics |
| --- | --- | --- |
| persona × personality | whose relationship with which character | private (today's scope — stays the default) |
| **place** | DM vs server(×channel) | DM pool encapsulated from server pools, shapes-style; encapsulation **toggleable** by the user |
| **community** | the server as a friend group with its own inside jokes/lore | a communal pool: memories formed in a server that the character shares with everyone in that server — distinct from any user's private pool |
| **canon group** | characters with aligned memories (fandom/universe grouping) | synchronized world-knowledge pools across a character group — teach once, all aligned characters know |

Retrieval blends pools by context: in a server → communal(server) + private(user×character) + canon-group; in DM → private (+ optionally server pools per the encapsulation toggle). No surveyed framework models the community or canon-group dimensions — custom layer, cheap on our substrate (scoping columns + blend policy; `guildId`/`channelId` columns and the channel-waterfall retrieval are the existing half).

**Community-pool consent package (council, unanimous — opt-in, and the strictest shape)**: default-OFF; server owner *enables the feature*, but each user must **individually opt in** before any of their content contributes (an admin can never opt users in); consent is **revocable with retroactive redaction** (opt-out removes their prior contributions). **Always excluded** regardless of consent: DMs, incognito turns, deleted/edited-away content, sensitive-tagged extractions, non-consenting participants' sides of scenes. **The pool stores derived lore (facts/snippets), not verbatim episodes** — unless a user explicitly `/memory share`s a scene (a strong privacy default: the group gets the inside joke, not the raw transcript). Browse shows a "who can see this" indicator.

**Cross-pool precedence (council)**: person-facts — private(persona×personality) beats community (the character's direct knowledge of you outranks group lore); world/canon-facts — canon-group beats all. Retrieval flags cross-pool contradictions rather than silently picking (renders both with pool labels; the supersession machinery works within a pool, precedence works across).

## 3. Target architecture

### 3.1 Memory model — typed, verbatim-preserving

| Type | What | Source | Retention posture |
| --- | --- | --- | --- |
| **episode** | verbatim moment (today's raw pair, properly bounded) + salience + emotional facet | captured per exchange (as today) | tiered aging; consolidation summarizes but NEVER deletes verbatim while tier ≥ warm |
| **fact** | atomic durable statement (user facts / world facts), with `valid_from`/`superseded_at` supersession | async extraction from episodes | supersede-on-write (the context-graph lesson: stale facts confidently returned are worse than none) |
| **reflection** | derived understanding ("mental model") — relationship state, patterns | consolidation jobs only | versioned; feeds the relationship block |
| **canon** | curated: lore-book entries, pinned memories | user-authored/pinned | never auto-aged; `isLocked` generalizes here |

Every memory: scoping columns per §2.2 (+ `fiction` flag for R7), provenance (`messageIds` populated — R8), salience, type, tier (active/warm/cold — accessibility, never deletion).

### 3.2 Write path — async extraction beside verbatim capture

Keep the synchronous verbatim episode capture (cheap, idempotent, proven). Add an **async extraction worker** (BullMQ): **turn-count batching (~every N turns) or fixed time-window — NOT "conversation lull"** (council, Qwen: lull thresholds either extract mid-scene or lag behind the next reply; note the recall-lag objection is largely moot because the current session sits in the history window — memory only needs to cover what falls OUT of it). Extraction: one structured-output prompt producing facts (with supersession targets — recent same-scope facts injected so the LLM can name what it supersedes) + salience/emotional scoring + entity tags; deterministic JSON parsing with **fail-to-skip** (never fail-to-hallucinate); event-not-fact bias with a fact floor (council, Kimi: long-arc consistency lives on atomic facts too — extract both, bias the *episode side* toward events). Semantic near-dup guard at write with an **eval-set-tuned threshold** (384-dim cosine is noisy — the threshold is measured, not guessed). No staged human review queue — auto-write with `/memory browse` curation, pins, and `/memory correct|forget` (§3.6a) as the human layer; extraction hallucinations are bounded by the eval harness (§3.9) + provenance links (every fact traces to source episodes).

### 3.3 Relationship model — block + facts-lite

- **Relationship block** (Letta paradigm, our containers): per persona×personality, a bounded slowly-evolving text block (current dynamics, standing, key context), maintained by consolidation jobs, rendered in the prompt's V-tier alongside retrieved memories (boulder #2 seam). This is R3 — voice/relationship continuity without retrieval luck. Council-hardened spec: **~256-token hard cap per block** (128 floor); in multi-user scenes, blocks render only for **scene-active participants** (spoke within last N turns — Qwen's attention-routing point: 4 idle users × fat blocks starves the window); the refresh prompt says **"replace entirely in ≤cap"**, never "update" (drift guard); a wrong block corrupts every reply, so `/memory correct` + `/memory forget` (§3.6a) override it immediately, no waiting for the next consolidation pass.
- **Fact supersession WITHOUT a triple store** (council: GLM argued drop the S/P/O + alias + recursive-CTE machinery as graph-complexity-without-graph-tooling; the roleplay case is covered by block + typed facts). Facts are flat rows with `valid_from`/`superseded_at` + optional entity tags; "current state + history" queries run on the fact table directly. **Supersession targeting is the hard part** (council, Qwen): the extraction prompt receives the recent same-scope facts so it can name what it supersedes, with a pre-write similarity match as fallback — otherwise contradictory facts accumulate silently. A dedicated triple/alias/multi-hop layer is deferred until an eval demonstrates multi-hop need (re-openable; the schema loses nothing by waiting).

### 3.4 Retrieval — multi-signal, deterministic, explainable

- **Hybrid**: dense cosine (existing) + Postgres FTS (`tsvector` + GIN) fused with RRF — one CTE, the highest-value/lowest-risk upgrade from the pgvector guide.
- **Composite scoring** (automem/OpenMemory pattern, plain SQL): similarity + salience + recency-by-type + type weights + contradiction/superseded penalties. Deterministic; **no LLM in the loop** (R9).
- **Pool blending** per §2.2 with budget ratios (the channel-waterfall generalizes).
- **Explain**: score components per retrieved memory surfaced in `/inspect`'s Memory Inspector (already a view — gains the breakdown).
- Substrate niceties as measured needs arise: halfvec, IVFFlat→HNSW (protected-index handling per `drift-ignore.json` — schema PR rider list applies).

### 3.5 Consolidation — scheduled, tiered, cheap-first (Claude Code's shape)

BullMQ scheduled jobs, cheapest-first: (1) near-dup merge; (2) scene summaries (episode clusters → summary episodes, verbatim kept per tier policy); (3) fact extraction backfill/supersession sweep; (4) reflection/relationship-block refresh ("dreaming"); (5) tier aging (active→warm→cold by salience×recency×access). Each stage has an off switch and telemetry (the OpenMemory lesson: no invisible background magic — explicit, auditable jobs).

### 3.6 Integrity layer (R8 — partially already filed)

Visibility filter in retrieval (prod fix, on the board) · re-embed on edit (rider, filed) · populate `messageIds` at capture → **message-actions policy**: source deleted → linked episodes soft-delete (and now actually disappear from RAG); source edited → episode re-captured/re-embedded; facts derived from a retracted episode get flagged for supersession review · db-sync propagation: deletion tombstones extend to memories (design detail deferred to the db-sync follow-up, but the schema leaves room).

### 3.6a User correction surface (council, all three)

`/memory correct` (fix a fact/block immediately — writes a superseding fact and triggers a block refresh) and `/memory forget` (propagating removal: the memory, facts derived from it, and its community-pool contributions). These are Phase-2-era commands, not Phase-6 polish — auto-write without a fast correction affordance is the "auto-write death spiral" council warned about. Lightweight feedback (`/memory good|bad` or reactions) feeds the eval corpus.

### 3.7 Schema disposition

`canonScope`/`sessionId` are REPLACED by the real scoping columns (§2.2) in an evolutionary migration (they finally get their intended semantics, properly named); `messageIds`/`senders` get populated; `type` gains the §3.1 enum; new: salience, tier, fiction flag, facts + entities + aliases tables, relationship_blocks table. All additive-first; destructive cleanup rides later (schema-PR rider list).

### 3.8 Cost guardrails (council, unanimous gap)

- **Fixed cheap extraction/consolidation model** (Haiku/GPT-mini-class or vetted free-tier AFTER precision eval — cheap-but-wrong poisons retrieval and costs more than paid-reliable). Never the personality's model (cost coupling invisible to users). This is §8 call 2 — council unanimous.
- **Extraction cadence cap** per conversation (max 1 pass / N turns) + per-day budget envelope; consolidation cost scales with corpus → tier-scoped runs (active tier nightly; warm weekly; cold on demand).
- **Kill switches + telemetry per worker** (the existing PendingMemoryProcessor dead-letter pattern generalizes: idempotent deterministic-ID jobs, retry caps, DLQ); cost-per-message and cost-per-conversation surfaced in ops:health.
- **Edit re-embed debounce** (settle window) — roleplay users edit in bursts.
- **New tripwire**: memory-pipeline cost exceeding a set % of reply-generation cost for a sustained window pages the owner and auto-throttles extraction cadence.

### 3.9 Evaluation harness (council, unanimous #1 gap — quality gates were referenced but undefined)

Before Phase 1a ships: a **golden eval corpus** — (a) retrieval goldens: N real conversation snapshots + "the bot should recall X" assertions (recall@K, before/after per phase); (b) extraction goldens (from Phase 2): message → expected facts, measuring precision/hallucination rate; (c) consolidation samples audited for duplicate/hallucination rate. Every phase ships with its before/after run; **the phase gates and the §1 re-open triggers all fire on THESE numbers**, not vibes. Owner feedback (`/memory bad`) accretes into the corpus. This is the solo-maintainer substitute for a QA team, and it is not optional.

## 4. Deliberately NOT doing

Agentic retrieval loops (MRAgent-style — over budget by orders of magnitude) · graph databases · framework/runtime adoption (triggers in §1) · LLM-scored retrieval · full-review extraction queues · deleting verbatim episodes as a space optimization (texture IS the product) · touching STM/history semantics (heal-on-read + epochs stay; boulder #2's window policy governs).

## 5. Phasing (each phase independently shippable, quality-gated)

| Phase | Contents | Discharges |
| --- | --- | --- |
| **0 — integrity + eval baseline** (fast-track; the prod fix may ship before this doc merges) | visibility filter + re-embed-on-edit (debounced) + `messageIds` population + message-delete propagation; **scoping schema columns land here** (council: extraction must write correctly-scoped rows from day one — blending logic comes later); **retrieval golden corpus established** (§3.9) | R8 core; the filed prod issue; §3.9 baseline |
| **1a — lightweight retrieval upgrade** | tsvector+RRF hybrid + simple recency on the EXISTING corpus (council: composite type-weights need types that don't exist yet); explain-in-inspect | Measurable quality lift on today's data, zero write-path risk |
| **2 — typed memories + extraction worker** | type enum, salience, async fact extraction w/ supersession targeting, dedup guard (eval-tuned), `/memory correct|forget` (§3.6a), cost guardrails (§3.8) live from day one | R1/R4 foundations |
| **1b — full composite scoring** | type-weights, salience, superseded/contradiction penalties (now that types exist) | The §3.4 scoring completed |
| **3 — scoping matrix activation** | pool blend policy + community consent flow + encapsulation toggle + fiction flag (columns existed since Phase 0) | §2.2, R7 |
| **4 — relationship layer** | relationship blocks (§3.3 spec) via boulder-#2 V-tier; fact-supersession already live from Phase 2 | R2/R3 |
| **5 — consolidation** | scheduled jobs (§3.5), tier aging — **light stages first; heavy stages only after Phase 6's audit surfaces exist** (council: users need to see/curate what consolidation touches) | R5 |
| **6 — curation surfaces** | lore books, pins-generalization, `/memory share`, community-pool indicators | R6 + lore-books commitment |

**Minimum-viable milestone (council reframe, adopted)**: Phases 0 + 1a + 2 form the smallest system that should visibly improve roleplay quality (integrity + hybrid retrieval + light typed extraction). **Phases 3–6 are evidence-gated**: each proceeds only if the eval corpus shows the prior phase paid off — this is scope-reduction-as-default, not scope-reduction-as-failure. Backfill posture: **no bulk re-extraction of the existing corpus** (cost); old episodes get Phase-1a retrieval gains as-is; optional salience-gated partial backfill only if evals show old-corpus recall gaps. Phases 2+ get plan-mode + council per phase at implementation time.

## 6. Memory-boulder absorbed commitments — discharge map

Lore books → §3.1 canon type + Phase 6 · message-actions history/memory invariant → §3.6 + Phase 0 · db-sync seed/deletion-propagation → §3.6 note + existing follow-up · MEMORY_MANAGEMENT_COMMANDS icebox (consolidation, facts-vs-vibes, sharing, export) → §3.5, §3.1, §2.2 canon-groups, Phase 6 · boulder-#2 hooks (RAG-vs-history contradiction, internal-recall framing) → supersession penalties §3.4 + V-tier rendering per that design.

## 7. Sources record

Full grounding reports in session archive. Key verified facts: mem0 v2.0 ADD-only pivot · Zep CE deprecated · Letta mid-restructure · LangMem stalled (Oct 2025) · LangGraph JS Store = substrate-only · Hindsight v0.8.4 alive, Postgres-native · memU v1.5.1 alive, pgvector, Python-only · OpenMemory rewrite paused 5 weeks, paradigm mined · MRAgent 118k vs LangMem 3.26M tokens/query (LongMemEval) · current system: no extraction, no visibility filter (prod issue filed), dead scoping fields, unlinked messageIds.

## 8. Open calls — post-council status

| # | Call | Status |
| --- | --- | --- |
| 1 | Community-pool consent | **Council unanimous**: per-user opt-in, default-off, admin can't opt others in, revocable w/ retroactive redaction, derived-lore-not-verbatim, exclusion list (§2.2 package) — **CONFIRMED 2026-07-05** |
| 2 | Extraction model routing | **Council unanimous**: fixed cheap budget model (Haiku/mini-class); never the personality's model; free-tier only after a precision eval — **CONFIRMED 2026-07-05** |
| 3 | Fiction flag | **Council split**: GLM = fold zero-marginal-cost classification into the extraction prompt as a correction layer; Kimi/Qwen = scope-derived defaults + explicit user markers only, no LLM. **DECIDED 2026-07-05: scope+markers canonical; the extraction prompt (already running) may flag obvious mismatches for review — defaults/markers always win** |
| 4 | Phase order | **Resolved via council synthesis**: 1a (hybrid on existing corpus) → 2 (types/extraction) → 1b (composite scoring) — both camps right about different halves; scoping schema pulled to Phase 0 — **CONFIRMED 2026-07-05** |
| 5 | Relationship-block budget | **Council convergent**: ~256-token hard cap, scene-active participants only, replace-not-update refresh (§3.3) — **CONFIRMED 2026-07-05** |
| 6 | Re-open triggers | **Sharpened** (measured on §3.9 goldens + cost tripwire + scope-reduction-first) — **CONFIRMED 2026-07-05** |
| 7 | **NEW: drop the triple table** | Council majority (GLM drop / Qwen cap at 1-hop / Kimi defer-heavy): flat fact supersession + relationship block cover the roleplay case; triple/alias/CTE machinery deferred behind an eval-shown need (§3.3) — **CONFIRMED 2026-07-05** |
| 8 | **NEW: minimum-viable milestone framing** | Phases 0+1a+2 = the bet; 3–6 evidence-gated on eval results (§5) — a real reframe of the build's shape — **CONFIRMED 2026-07-05** |

## 9. Council + verification record (2026-07-05)

**Trio**: GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max. **Unanimous alarms, all adopted**: evaluation harness was referenced-but-undefined (→ §3.9, now load-bearing for gates AND triggers); cost guardrails unspecified (→ §3.8); community pool must be strict opt-in (→ §2.2 package). **Structural corrections adopted**: scoping schema before extraction (GLM+Kimi — avoids a re-scope migration); Phase 1a/1b split (Qwen's "you can't tune type-weights on an untyped corpus" + GLM/Kimi's "retrieval first" — both right); curation surfaces before heavy consolidation (Kimi); triple table dropped (GLM, majority); turn-count batching over "lull" (Qwen); supersession-target injection into extraction prompts (Qwen); relationship-block hard cap + active-participant routing + replace-prompt (all three); `/memory correct|forget` as Phase-2 commands not Phase-6 polish; fail-to-skip extraction parsing; backfill = new-data-forward.

**Rebutted with evidence**: Kimi + Qwen both called LangChain JS 1.x / the 2026 Store docs "unreleased/vaporware" — fact-verified SHIPPED this session (langchain 1.5.2, @langchain/core 1.2.1 in our own package.json; JS long-term-memory docs fetched). Kimi's recall-lag objection — largely moot: the current session sits in the history window; memory covers what falls out of it. Kimi's "no framework has your taxonomy is unproven" — it is proven for the surveyed set (8 systems + roleplay ecosystem, §7); the claim is scoped to the survey, not the universe.

**Honest concessions recorded**: the adjudication's cost/Claude-Code pillars downgraded to contextual (§1); the full build IS multi-quarter for a solo maintainer — hence the minimum-viable milestone + evidence gates (§5) as the structural answer rather than optimism.
