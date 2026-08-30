---
id: doc-84
title: >-
  Idea: Standardize emitted-file naming, format, and uniqueness across every
  export path
type: other
created_date: '2026-08-30 19:05'
---

## Why

Owner request. Every place the bot hands a user a file has invented its own
naming convention, and the drift is visible inside a single command family. The
ask is explicitly a **survey first** — enumerate everything we create or export,
then standardize *within reason*, because some names are fixed for good reasons
and must be left alone.

## The drift, measured (not assumed)

Enumeration command, run against `services/` excluding tests:

```
grep -rnE "name: [\`'\"].*\.(txt|json|xml|md|png|jpg|webp|mp3|ogg|wav)" \
  services/ --include="*.ts" | grep -v "\.test\.ts"
```

Positive control: it matches `services/bot-client/src/commands/inspect/views.ts`,
a known-present emit site. **This grep is the search space, not the answer** —
it only finds literal `name:` assignments. It cannot see a filename built and
passed positionally, one assembled in a helper, or anything emitted outside
`services/`. Widening the enumeration is the survey's first job.

### Separator convention splits three ways

| Convention | Sites |
|---|---|
| kebab-case | `nightly-db-sync-report.md`, `debug-${requestId}.json`, `debug-compact-${requestId}.json`, `system-prompt-${requestId}.xml`, `reasoning-full.txt`, `input-full.txt`, `post-processing-full.txt`, `messages-${requestId}.txt`, `${slug}-avatar.png` |
| snake_case | `preset_template.json`, `character_card_template.json`, `voice_omitted_too_long.txt` |
| bare | `${slug}.json`, `${filename}.json`, `memory-${id8}.txt` (kebab prefix, truncated-id suffix) |

Note for the record: the owner's request named `reasoning_full.txt`; the actual
constant is `reasoning-full.txt` (`views.ts:271`). That the two forms are equally
plausible from memory *is* the problem.

### Uniqueness is inconsistent within one feature

`/inspect` is the sharpest case. Four sibling overflow/export files, two policies:

- Carry the request id: `debug-${requestId}.json` (`views.ts:101`),
  `debug-compact-${requestId}.json` (`views.ts:162`),
  `system-prompt-${requestId}.xml` (`views.ts:199`),
  `messages-${requestId}.txt` (`extendedViews.ts:525`)
- Static, so two in one channel are indistinguishable:
  `reasoning-full.txt` (`views.ts:271`), `input-full.txt`
  (`extendedViews.ts:167`), `post-processing-full.txt` (`extendedViews.ts:282`)

All four `extendedViews`/`views` overflow files come from the same
`overflowFilename` mechanism, so the split is not a considered design — it is
whoever wrote each line. Other static names with the same collision exposure:
`nightly-db-sync-report.md`, `preset_template.json`,
`character_card_template.json`, `voice_omitted_too_long.txt`.

### Format may be mislabelled

`reasoning-full.txt` is `.txt`, but a model reasoning trace is generally
markdown (headings, lists, fenced code). `nightly-db-sync-report.md` already
establishes `.md` as an in-repo precedent, so the extension choice is a real
question with a real answer, not bikeshedding: the extension is what decides
whether Discord and the user's editor render it readably.

**Do not assume the trace is markdown — sample it.** One `/inspect` overflow
file from a real generation settles it, and the answer may be model-dependent
(different providers format reasoning differently — see the GLM/Kimi
reasoning-format notes in the research docs).

## Prior art to reuse, not reinvent

The owner recalls an elaborate naming scheme for voice-synthesis files uploaded
to Discord. **Find it before designing anything** — if a considered scheme
already exists, the standard should generalize it rather than compete with it.
`services/bot-client/src/utils/dashboard/truncationGate/entityEditFlow.ts:175`
also already routes through a `toSafeFilename()` helper, which is a second piece
of existing art the survey must account for.

`tracker/archive/tasks/task-86` covered dashboard action-naming kebab-vs-snake
drift — same class of problem, different surface. Worth reading for whatever
convention it settled on, so this does not pick a conflicting one.

## Scope

**In scope:** every file the system hands to a user or writes for later reading —
Discord attachments, character/preset exports and templates, `/inspect` debug
dumps and overflow files, memory exports, the nightly sync report, avatar
exports, `export_jobs.fileContent` payloads.

**Explicitly allowed to keep their names**, subject to the survey confirming
each: anything whose name is an external contract (an import format another tool
reads, a fixture a test pins by name, a filename a published doc instructs users
to look for). The owner's framing — "within reason, some things have specific
names for a good reason" — is a scoping instruction, not a caveat: each
exception is named with its reason, and unexplained exceptions are drift.

## Shape of the work

1. Survey — widen the enumeration past the grep above; produce the full table of
   emit site → filename → format → uniqueness policy → is-it-contractual.
2. Decide — one separator convention; when a discriminator (request id, slug,
   entity id, timestamp) is required vs. when a static name is correct; and how
   the extension is chosen from actual content.
3. Apply — mechanical, one PR, with the exceptions table written down where the
   next person will find it.

## Acceptance

The survey table exists and covers every emit site the widened enumeration
finds; a stated convention covers separator, discriminator, and extension;
every file a user can receive twice in one channel is distinguishable; each
retained non-conforming name carries its reason; and the convention lives
somewhere loaded at authoring time so the next emit site follows it without
anyone remembering this document.
