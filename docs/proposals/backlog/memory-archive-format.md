# Memory Archive Format — the character stops rereading its own prose

> **Status**: ACCEPTED 2026-09-05 — council pass folded (§6, four of four answered); owner sign-off 2026-09-05 (§7): all four recommendations confirmed via `AskUserQuestion`.
> **Extends** [`memory-architecture.md`](memory-architecture.md) (ACCEPTED 2026-07-05): this is the first slice of the re-entered memory epic (`doc-8`), and the **Linked Intent Development pilot segment** (owner ruling 2026-07-20, restated 2026-09-05: LID starts at this design pass). It changes what an episode _renders as_, not what an episode _is_ — §3.1's "verbatim is never deleted while the tier is warm" holds.
> **Owner directives (verbatim, 2026-09-05)**: "none of the other work matters if I feel like I'm losing touch with my characters. backfill isn't off the table at this point" · "messing with parameters might break reasoning so I'm not inclined to try it unless absolutely necessary" · at the beta.218 cut: the voice anchor first, `doc-8` active, LID from this pass.
> **Grounding** (2026-09-05): the drift curve on one character (`doc-97` § Evidence, 2,135 memories, aggregates only) · an Explore pass over the write path, the render path, the schema, the accepted architecture doc, `doc-8`, and the LID reference (repo `jszmajda/lid`) · a read-only prod measurement of the whole archive and of extraction-call cost (§1). Facts are marked [V] verified by read or query, [I] inferred.
> **Council-rebuilt**: the draft's central decision (a new summary tier) was challenged by three of four panel models as unproven against a zero-pipeline alternative; §2 now starts with a pilot that measures both before anything is built (§6 records who said what).

## 0. The concern at the center

A character that has talked for months stops sounding like its card. The measured mechanism (`doc-97`): the card sits ~45k tokens upstream behind the prompt-cache boundary while ~43k tokens of the character's **own prior prose** sit at the generation point — half of it cross-channel history, the rest the memory archive, which stores every reply verbatim and renders it back on every retrieval. The voice anchor (#2348) restates the card next to the turn; this artifact removes the archive's half of the feedback loop. The history half is the prompt-caching epic's Phase 2 (`doc-17`), queued behind this.

## 1. The system as it is [V]

- **Write.** `LongTermMemoryService.storeInteraction` composes `{user}: ${userMessage}\n{assistant}: ${aiResponse}` (line 61) and stores it verbatim as `memories.content`; `MemoryPersistenceService.buildContentForEmbedding` appends `[Referenced content: …]` for replies that quoted a message (lines 31–41). Called synchronously from `ConversationalRAGService.processUserMessage` (line 352). The embedding is over that whole text. No summarization exists anywhere on the write path.
- **Read.** `MemoryFormatter.formatSingleMemory` renders `<historical_note t="…">content</historical_note>` with no per-memory cap (lines 135–158); the archive instruction calls them "summarized notes from past interactions" — they are not. Selection is a relevance knapsack in `MemoryBudgetManager` against the remaining context window. Facts render separately, in the `facts` V-tier section, from `memory_facts`.
- **Schema.** `memories` has `content`, `embedding` (384-dim), `messageIds`, `senders`, `pool`/`canonGroupId`/`isFiction`, chunking columns, and three legacy summary markers (`isSummarized`, `originalMessageCount`, `summarizedAt`, `summaryType`) with no active writer. No column holds a summary. `memory_facts.sourceMemoryIds` links every extracted fact to the episode it came from.
- **Extraction worker** (`jobs/factExtractionSetup.ts`): BullMQ, batched by `extractionBatchThreshold`, model from the `extractionProvider`/`extractionModel` settings, `extractionEnabled` kill switch, usage rows tagged `fact_extraction`. This is the shape any second asynchronous per-memory model call rides.
- **The archive today, prod, 2026-09-05** (read-only query, aggregates):

| Measure | Value |
| --- | --- |
| Memories | 44,414 across 197 characters; the largest character holds 29% |
| Stored size | avg 2,024 chars · p50 1,523 · p95 5,049 · total ~90M chars (~22M tokens at 4 chars/token [I]) |
| Assistant share | 69% of content on average (1,393 chars) |
| Rows carrying `[Referenced content: …]` | 28% |
| New memories per month | ~4.3k (Jul) · ~4.5k (Aug); average size 1,900 → 2,946 (Aug) → 3,331 (Sep, partial) |
| Extraction calls, last 30 days | 633 on the extraction model; avg 5.2k tokens in, 4.3k out (reasoning-heavy) |

  Two things the table settles: reply bloat is catalog-wide, not one character's habit, and the assistant side is the bulk of what the archive carries. A rendered memory costs ~500 tokens today; its user half is ~150 of those.

## 2. Decisions

**D0 (council-rebuilt) — Pilot two render shapes head-to-head before building any summarizer.** The draft asserted that facts lose the episode narrative and therefore a summary tier is needed. Three of four panel models called that an untested assertion: the fact tier already exists, is already measured by the extraction goldens, and rendering _user side verbatim + the episode's linked facts_ is a string split plus a join on `memory_facts.sourceMemoryIds` — zero new pipeline. So the first slice is a **pilot on a fixed corpus** (≥3 characters with distinct voice profiles — the drifted one, a healthy one as a no-harm control, and a terse or clinical one — plus the largest rows in the corpus rather than a random sample, because sizes are rising), rendering the same retrieved set three ways:

| Arm | Assistant side rendered as | Pipeline needed |
| --- | --- | --- |
| V (control) | verbatim, today | none |
| F | omitted; the episode's linked facts appear beside the user turn | none (facts exist) |
| S | a third-person summary produced offline by a script over the pilot rows | a prompt and a script, no worker |

  Measured per arm (D7): rendered-prompt answer correctness on golden questions, hallucination rate, card adherence, referenced-content recall, tokens in the tail. **If F ties S, the summary tier is not built**: the shipped change is the F render plus a "commitment" fact type added to extraction (the panel's own proposal for the one thing facts miss). If S wins, D1–D5 below ship. Either way the pilot settles open call 6 on numbers rather than on the sentence the draft offered.

**D1 — Render split: user side verbatim, assistant side replaced by whichever the pilot picks (facts, or a summary).** The user's words carry the recall value the retrieval goldens are built on (31% of content); the character's prose is the loop.
_Rejected_: summarizing both sides. _Council-added_: the user side is not automatically safe — strip quoted assistant lines from it at render (the reply-quote convention) and cap per-note user tokens at the p95 of the user half.

**D2 (council-rebuilt) — If a summary ships, it is produced at write time, asynchronously, persisted in a new nullable `memories.assistant_summary` with status columns, and a null NEVER re-injects verbatim once the character is switched on.** The draft's "null → render verbatim" fallback was rejected by three models: async lag makes the newest, most-retrieved rows exactly the ones still null, so the toxin would be re-injected precisely where the drift is freshest. The rule: while a character's switch is off, render as today; once on, a null summary renders as arm F (user side + facts) and the row is enqueued. Columns: `assistant_summary`, `summary_status` (pending | done | failed | dead), `summary_attempts`, `summary_model`, `summary_prompt_version`, `source_content_hash`, `summary_requested_at`, `summary_completed_at`. `content`, the embedding, extraction, consolidation, and the `/memory` surfaces keep reading verbatim; `/memory view` additionally shows the summary when present, so the owner can debug against the text the character actually consumed.
_Rejected_: render-time summarization (cost multiplies with retrievals; nothing persists). _Rejected_: replacing `content`.

**D3 (council-rebuilt) — The summarizer is its own BullMQ queue with its own prompt version, separate from extraction.** Same model settings and the same fail-soft posture, but: deterministic `jobId = memory.id` (free dedup against enqueue storms), attempt cap 3 then `dead` with a dead-row report, a rate limiter and a daily spend guard on the queue, strictly lower priority than extraction so a sweep never starves facts, and usage rows tagged `archive_summary` carrying memory id, prompt version, tokens, latency, error class. **Three switches, not one**: job creation, model call, and render use — and the render switch is per character, because the gate evidence covers a handful of characters and the flip must not be all 197 at once. Not on the reply path.

**D4 (council-rebuilt) — Summary contract: third person, faithful, 60-word soft target with a 100-word hard cap measured in tokens, validated not truncated.** The draft's sentence-boundary truncation manufactured false completeness (a truncated summary asserts a partial fact set as the whole episode). Instead: instruct ≤60 words; validate; one regeneration pass ("tighter, keep every commitment"); accept and log overflow up to the hard cap; overflow rate is a pilot metric. The register line is redrawn: discard prosody, formatting, and first-person voice; **preserve speech acts including forms of address** (a promised nickname is a commitment, not style — the draft's "no pet names" would have discarded facts). Add a faithfulness clause (assert nothing not in the source) and 3–5 worked examples in the prompt. The `[Referenced content: …]` block is summarizer input and is not rendered; the contract **forces referent resolution** ("agreed with the plan" must name the plan) and the pilot reports the dangling-reference rate on the 28% of rows that carry one.

**D5 (council-rebuilt) — Backfill is hot-first, then lazy; never silent.** Before a character's render switch flips on, a frequency-ordered pre-warm sweep summarizes its retrieved-within-the-window rows (the operator command, with a pre-sweep token estimate); the cold tail is summarized lazily on first retrieval (rendering as arm F meanwhile, per D2). Gate for the flip: ≥95% of that character's rendered archive is summarized over a trailing window, measured from telemetry (`verbatim_fallback_renders`, per-character summarized share, `time_to_summary_p95`, queue depth).
_Rejected_: pure lazy — the first retrieval of every hot row renders the wrong thing and enqueue storms hit the queue on flip day. _Rejected_: no backfill. _Owner call_ (§5): whether to run a full bulk sweep instead — one clean cutover for the eval, at roughly 29M input tokens [I] (tens of dollars on the extraction model), most of it on rows nobody retrieves.

**D6 — The embedding does not change in this slice, but the mismatch is measured.** The vector is computed over the verbatim blob including referenced text; the render will show less. Three models flagged that retrieval can rank on phrasing the render hides. The pilot adds a shadow-retrieval precision check (does the rendered note still answer the query that retrieved it) and logs the embedding version; re-embedding on `user_text + facts` is the consolidation phase's evidence-gated call.

**D7 (council-rebuilt) — Gates test the rendered contract, not the pieces.** (a) **Rendered-prompt QA** on golden questions per arm: answer correctness, and a **faithfulness/precision** check (does the render assert anything the episode did not — an invented commitment in trusted text is worse than drift), judged by a model from a different family than the summarizer, plus a 30-row human spot-check inside the pilot. (b) **Voice**, pre-registered: n replies per arm and the window fixed in advance; the `doc-97` markers plus a **third-person self-reference rate** guard (the mechanism's own predicted failure: a character narrated in third person starts narrating itself); the realistic bar while the history half is still live is "no further drift, no regression", not recovery. (c) **Fallback exposure** from D5's telemetry. Recall@K goldens are reported for completeness but certify nothing here — the embedding is unchanged.

**D8 (council-folded into A) — The archive instruction ships atomically with the render change**, describing what the text _is_ ("neutral third-person records of past events; the user's words verbatim") rather than naming the suppressed style — negative instructions beside the behaviour they suppress prime it.

**D9 — LID pilot scope: the control planes.** `docs/intent/memory-archive/memory-archive-design.md` (this artifact's decisions as the LLD) and `memory-archive-specs.md` (EARS requirements `MEM-ARCH-NNN`), with `// @spec` at: the render serializer and its fallback rule, the summarizer processor, the enqueue dedupe, the retry/dead-row path, the sweep command, and the kill-switch read path. Every touched function is rot bait. The HLD is `memory-architecture.md`, which gains a `## LID` pointer.

**D10 (council-added) — Fact/summary coexistence rule.** Facts already render in the `facts` section; when arm S ships, a fact whose `sourceMemoryIds` names a memory rendered in the archive is not rendered twice (the archive note wins for that turn), and the knapsack's memory _count_ cap stays where it is today so the freed tokens are a saving, not room for more notes.

## 3. What this deliberately does NOT do

- Touch cross-channel or channel history (`doc-17` Phase 2, queued behind this by owner call).
- Change what `/memory browse`, exports, or the sync pipeline show — all read `content`; `/memory view` only gains the summary line.
- Re-embed anything, change the knapsack's selection, or alter fact extraction beyond a possible "commitment" fact type.
- Summarize the user side.
- Build the summarizer before the pilot says it beats the zero-pipeline arm.

## 4. Schema and phasing sketch

```prisma
/// Deferred-set: null until the archive summarizer has processed this row.
/// While the character's render switch is on, a null row renders as user
/// side + linked facts — never the verbatim assistant side.
assistantSummary String? @map("assistant_summary")
```

| Slice | Contents | Gate |
| --- | --- | --- |
| P — pilot | offline script over the fixed corpus: arms V / F / S, the D7 metrics, cost per row, overflow and dangling-reference rates; results into this doc | the numbers decide F-only vs S |
| A — render split + specs | `MemoryFormatter` renders user-verbatim + (facts or summary), quoted-assistant stripping, per-note cap, instruction text (D8), the LID specs, `@spec` at the control planes, `/memory view` summary line | unit tests; snapshot; `guard:proposal-links` |
| B — summarizer (only if S won) | schema columns, the queue with dedupe/attempt cap/rate limit/spend guard, three switches, telemetry, the prompt with worked examples | D7 (a) on the pilot corpus; fact-preservation and faithfulness thresholds set from P |
| C — hot-first backfill + per-character flip | pre-warm sweep, lazy tail, `pnpm ops memory:summarize --personality <slug> --env dev\|prod --estimate`, the ≥95% gate | D7 (b) and (c) green on the drifted character → flip it; then the rest one at a time |

## 5. Open calls (recommendation first)

1. **Pilot-first restructure (D0)** — **CONFIRMED 2026-09-05**: run the three-arm pilot before building anything. Alternative declined: build the summarizer now and pilot it against verbatim only.
2. **Backfill mode** — **CONFIRMED 2026-09-05**: hot-first pre-warm plus lazy tail, per-character flip. Alternative declined: one full bulk sweep (GLM's clean-cutover argument stays on record for the consolidation phase).
3. **Referenced content** — **CONFIRMED 2026-09-05**: not rendered; the contract forces the summary to name the referent; the pilot reports the dangling-reference rate. Alternative declined: a one-line pointer (promote it if the dangling rate says so).
4. **Null-summary policy once a character is switched on** — **CONFIRMED 2026-09-05** (inside the fold): render user side + facts, never verbatim. Alternative declined: a synchronous placeholder at write time.
5. **Summary length** — **CONFIRMED 2026-09-05** (inside the fold): 60 soft / 100 hard in tokens, validate-and-regenerate. Adaptive ceiling stays available if the pilot's overflow rate wants it.
6. **System key pays** — confirmed 4-0 by the panel and by the owner inside the fold.

## 6. Council record (2026-09-05, four of four answered)

Panel: GLM 5.2 · Kimi K3 · Qwen 3.8 Max · DeepSeek v4 Pro, one identical adversarial brief each (verified context, D1–D9, six open calls), sent in parallel.

**Adopted (unanimous or 3-1):**
- The 60-word hard cap with silent truncation was wrong — 4-0 (GLM, Qwen, DeepSeek: 100; Kimi: 60 soft). Rebuilt as D4: soft 60 / hard 100 in tokens, validate-and-regenerate, overflow logged.
- A silent verbatim fallback while switched on was wrong — Kimi, Qwen, DeepSeek. Rebuilt as D2's null rule and D5's telemetry gate.
- Kill switch must gate the render, per character; deterministic job ids; attempt cap; rate limit and spend guard; separate queue priority — Kimi, Qwen, DeepSeek. Rebuilt as D3.
- The summarizer's own register is a new, weaker drift vector, unmeasured — GLM, DeepSeek, Kimi (the third-person self-reference guard). Folded into D7(b).
- No faithfulness/precision gate; the judge shares the summarizer's blind spots — Kimi, Qwen. Folded into D7(a) with a different-family judge and a human spot-check.
- Facts + user-side-only must be piloted head-to-head before a summary tier is built — GLM (primary arm), Kimi (zero-pipeline arm; if it ties, scrap B–D), Qwen (fact-first primary). Rebuilt as D0 and slice P.
- The instruction text ships atomically with the render — Qwen. Folded into A.
- Forms of address are facts, not style; the contract needs worked examples and referent resolution — Kimi. Folded into D4.
- Embedding/render mismatch needs a measurement — GLM, Qwen, DeepSeek. Folded into D6.
- Fact/summary coexistence needs a rule; the knapsack will refill freed budget — DeepSeek, Qwen. Added as D10.
- `@spec` at the control planes rather than exactly four points — Qwen (with GLM, Kimi, DeepSeek content with four). D9 names six seams.
- System key: 4-0.

**Split, handed to the owner (§5):**
- Backfill: GLM full bulk after pilot; Kimi lazy + frequency-ordered pre-warm; Qwen targeted bulk for hot rows then lazy tail; DeepSeek lazy + sweep with guards. Three of four converge on hot-first + lazy tail with guards; GLM's clean-cutover argument is real and cheap.
- Referenced content: GLM and DeepSeek want a one-line pointer; Kimi input-only iff referent resolution is forced; Qwen input-only. 2-2 on the render, 4-0 that the referent must survive somewhere; the recommendation takes Kimi's bridge.
- Null-summary policy: Qwen omit/facts; DeepSeek synchronous placeholder; Kimi accepts fallback with metrics; GLM (via bulk) avoids the state. Recommendation follows Qwen.

**Declined:**
- DeepSeek's synchronous extractive placeholder at write time — it puts a model-shaped step back on the reply path the design exists to keep clear; the null-renders-as-facts rule covers the gap without latency.
- Qwen's structured `user_text`/`assistant_text`/`referenced_text` columns — the right long-term shape, but a migration over 44k rows is the consolidation phase's move; this slice uses the existing separator with a tested parser and the quote-stripping rule.
- DeepSeek's "D1 is already the smallest correct step" — outvoted 3-1 on the specific point that the claim has no eval behind it; the pilot is how it gets one.

**Ship verdicts as given**: GLM — A yes, B only with the facts arm; Kimi — A yes, B after the validator, dedup, render switch, hallucination check; Qwen — no as drafted; DeepSeek — no as drafted. All four objections are addressed by the rebuilt sections above or handed to the owner.

## 7. Owner pass

2026-09-05, one `AskUserQuestion` batch, four questions: **confirm the folded set** → confirmed; **pilot first** (three arms before any summarizer) → confirmed; **backfill** → hot-first then lazy tail; **referenced content** → no pointer, the summary names the referent. No owner-refined decisions beyond the recommendations. Next build unit: slice P, the pilot script, as the LID pilot's first artifact (specs for the render contract come with slice A).
