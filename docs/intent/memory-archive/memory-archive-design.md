# Memory Archive: LLD — Slice A

Status: LIVE — slice A

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

## Not in slice A

`/memory view`'s summary line needs slice B's `assistant_summary` column and
has nothing to show while only the F arm exists — deferred to slice B.
