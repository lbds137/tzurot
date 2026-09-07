# Memory Archive: LLD — Slices A and B1

Status: LIVE — slices A and B1

HLD: [`docs/proposals/backlog/memory-architecture.md`](../../proposals/backlog/memory-architecture.md).
Accepted artifact (decisions D0–D10, pilot results): [`docs/proposals/backlog/memory-archive-format.md`](../../proposals/backlog/memory-archive-format.md).
Specs: [`memory-archive-specs.md`](./memory-archive-specs.md).

## What slice A builds

Slice A ships the pilot's F arm (user turn verbatim + linked facts) as the
interim render behind a per-character switch, with no new model calls; the
pilot picked S, whose summarizer arrives in slice B. Slice B adds the async
summarizer (D2–D5) and `/memory view`'s summary line.

## The boundary split

The stored `{user}: … \n{assistant}: …` template is split back into its parts
at the STORAGE boundary, not at render time: `mapQueryResultToDocument`
(`services/ai-worker/src/utils/memoryUtils.ts`) calls
`splitMemoryContent` (`packages/common-types/src/utils/memoryContentSplit.ts`,
moved from the render-pilot tooling) and stamps `metadata.userTurn` +
`metadata.subjectName` on the returned `PgvectorMemoryDocument`. A row that
doesn't match the template (legacy content) leaves both fields `undefined` —
never a default — because their absence is what the renderer reads to select
the verbatim fallback.

## The switch

`archiveSplitRenderPersonalities` (`packages/common-types/src/schemas/api/systemSettings.ts`)
is a system setting holding an array of personality SLUGS — a new `list`
control type added to the registry
(`packages/common-types/src/schemas/api/systemSettingsRegistry.ts`) alongside
`boolean`/`integer`/`enum`/`model`. Empty = every character renders verbatim.
Read per turn, by the responding personality's slug, in
`retrieveMemoriesAndFacts` (`services/ai-worker/src/services/factRetrievalHelper.ts`).

## The mode carry

The render mode is decided ONCE per turn and carried ON the retrieved memory
docs, never re-derived downstream: when the switch is on for this turn's
personality, `factRetrievalHelper.ts` fetches linked facts for the retrieved
memory ids in ONE query (`FactRetriever.retrieveLinkedFacts` →
`FactStore.findActiveFactsBySourceMemoryIds`) and stamps every doc's
`metadata.archiveRender = { mode: 'split', linkedFacts }` — `linkedFacts` is
that doc's own facts, `[]` when it has none. When the switch is off, nothing
is written (absence is verbatim mode). A linked-facts fetch failure degrades
to `linkedFacts: []`, never to falling back out of split mode — D2's spirit:
the switch being on means assistant prose does not come back because a query
failed.

## The render

`MemoryFormatter.ts`'s `formatSingleMemory` dispatches on
`doc.metadata?.archiveRender?.mode`: split-mode notes render through
`renderSplitNoteBody` (`services/ai-worker/src/services/prompt/MemoryNoteSplitRender.ts`),
which pipelines the stored `userTurn` through `stripLegacyLocationSpans` →
`stripQuoteLines` (drops `> `-prefixed lines) → `capUserTurn` (3,000-char cap,
see below) → `escapeXmlContent`, prefixes the speaker label when
`subjectName` is present, and appends a "Recorded about this exchange:"
bullet list of linked facts sorted salience-descending when any exist. A
legacy row with no stored `userTurn` renders its verbatim `pageContent`
through the SAME strip → cap → escape pipeline, with no speaker label, no
quote stripping, and no facts section — `usedFallback: true` in the returned
stats. `formatMemoriesContext` picks the mode from the FIRST doc (A3 stamps
all-or-none across one turn's retrieved set) and selects between
`MEMORY_ARCHIVE_INSTRUCTION` (verbatim) and `MEMORY_ARCHIVE_SPLIT_INSTRUCTION`
(split) via `buildMemoryArchiveXml`. Verbatim-mode output is byte-identical to
before this slice.

## The fallback

`capUserTurn` (`MemoryNoteSplitRender.ts`) caps a user turn at
`ARCHIVE_USER_TURN_CAP_CHARS` (3,000 — the catalog-wide p95 of the stored user
half at measurement), cutting at the last whitespace at or before the cap and
appending ` […]`, or hard-cutting at the cap when no whitespace exists in
range.

## D10 — no fact renders twice

`FactForPrompt` gains `id?: string`, and each `archiveRender.linkedFacts`
entry gains `id`. In `PromptBuilder.buildVolatilePrefix`,
`dropFactsCoveredByArchive`
(`services/ai-worker/src/services/prompt/dropFactsCoveredByArchive.ts`) drops
a fact iff its id appears inside a SURVIVING note's rendered `linkedFacts`; a
fact with no id is kept. The dedup key is deliberately the rendered id, not
source-memory overlap: `stampArchiveRenderMode` attributes a fact linked to
several memories to exactly one of them (the most relevant, before budget
selection ever runs), and budget selection is not a prefix cut — it can drop
that one memory while keeping a smaller sibling later in the list, so a
surviving sibling source memory does not mean the fact was actually rendered.
This is applied ONLY in split-mode turns, before `formatFactsContext`;
verbatim-mode facts are untouched.

## Telemetry

`formatMemoriesContextWithStats` (`MemoryFormatter.ts`) renders the prompt
text and returns the `ArchiveRenderSummary` (interface in
`MemoryNoteSplitRender.ts`) in the same single pass — mode, note count,
`verbatimFallbackNotes` (D5's `verbatim_fallback_renders`), capped-note count,
quote-lines-stripped count, linked-fact count — logged as IDs/counts only
(never memory or fact text) by `PromptBuilder.buildVolatilePrefix` beside the
existing `'Volatile prefix composition'` line.

## Slice B1 — the summarizer (write side)

Constructs the write half of the pilot's arm-S summarizer as a real BullMQ
worker, wired to the memory write path. No rendering, no retrieval-time
enqueue, no `/memory view` change — those are slice B2 (the read side).

**The queue.** `archive-summary` (`ARCHIVE_SUMMARY_QUEUE_NAME`), worker-internal
to ai-worker, separate from `fact-extraction` so a summary backlog never
starves fact extraction. `defaultJobOptions.removeOnComplete`/`removeOnFail`
are plain booleans, not history counts — the memory ROW is the ledger
(`summary_status`, `summary_attempts`, `summary_last_error`), so Redis only
needs the in-flight job set. Concurrency 1, a worker rate limiter
(`ARCHIVE_SUMMARY_RATE_LIMIT`), and the same lock-duration/stalled-count
posture as fact extraction.

**The trigger and its deterministic jobId.** `ArchiveSummaryTrigger.enqueue`
tail-calls after a non-chunked memory row is stored (`PgvectorMemoryAdapter`
constructor gains an optional third param). The BullMQ jobId IS the memory's
own id — an enqueue storm (a retried write, a future re-summarize sweep)
dedupes to the single in-flight job for that row. Chunk rows are deliberately
never enqueued: a chunk never matches the stored template, so it could only
ever die as `no_template`. After a successful add, the row is stamped
`pending` via raw SQL (a `done` row keeps its status and its live summary
until the new one lands).

**The three gates, and why each delays rather than fails.** In order: (a) the
`archiveSummaryModelEnabled` switch off, (b) the resolved system-model route
is not `zai-coding` (an OpenRouter route cannot disable reasoning and must
never bill a summary — logged once per process, not once per job), (c) the
daily budget exhausted. Each uses BullMQ's manual-delay idiom
(`job.moveToDelayed` + `throw new DelayedError()`) so no retry attempt is
consumed and nothing is written to the row — the event being waited on is a
switch flip or a UTC-day rollover, not a transient failure. The budget gate
also returns its charge before delaying, so a delayed job does not consume
the daily cap on every hourly retry.

**The per-job flow.** Load the row (one query joining `personas`/
`personalities` for the prompt's names) → idempotence check (full sha-256 of
`content` against `source_content_hash` + prompt version; `done`/`dead` rows
with a matching hash and prompt version skip entirely — both terminal writers
stamp the version, so a `dead` row is not re-billed on re-enqueue) → the
switch and route gates → split the
stored `{user}: … {assistant}: …` template → the budget gate → summarize →
validate (length, first-person, dangling referents) → at most one
regeneration pass, each referenced row getting a referent-check call before
and after → write. The split runs BEFORE the budget gate because it is a
zero-spend terminal check: `no_template` content is marked `dead` with no
model call and consumes no budget at all. The switch and route gates still
precede the split because a `dead` write must not happen while the
summarizer is switched off or misrouted.

**The raw-SQL write rule and its sync reason.** Every write to `memories`
here uses `prisma.$executeRaw`, never `prisma.memory.update` — `memories` is
sync-tracked and dev↔prod reconciliation is last-write-wins on `updated_at`
(`.claude/rules/03-database.md` § Sync-Tracked Tables), so an ORM `update()`
would let a machine-generated summary out-rank a genuine content edit made in
the other environment. A billed failure's attempts count and resulting
status (`failed` vs `dead` at `MAX_SUMMARY_ATTEMPTS`) are computed from the
SAME SQL `CASE` expression, so they can never disagree under a concurrent
write. Conversely, a genuine content edit (`api-gateway`'s memory-edit route)
uses the ordinary Prisma `update()` and SHOULD bump `updated_at` — it resets
every summary column, since the edited content invalidates the old summary
outright.

**The three switches.** `archiveSummaryEnqueueEnabled` (job creation),
`archiveSummaryModelEnabled` (model calls — separate from enqueue so a
backlog can build before any spend), and `archiveSummaryDailyCap` (global,
all characters combined, per UTC day). All three live in the new
`memory-archive` system-settings group alongside slice A's own
`archiveSplitRenderPersonalities` — the per-character RENDER switch is slice
A's, not a new setting; B1 only adds the three write-side knobs.

## Not in slice A/B1

`/memory view`'s summary line needs the retrieval-time enqueue and rendering
change — deferred to slice B2, along with lazy-fill (`reason: 'retrieval'`)
and pre-warm (`reason: 'sweep'`) enqueue paths, both already reserved in the
job-data schema's `reason` enum but unproduced until B2.
