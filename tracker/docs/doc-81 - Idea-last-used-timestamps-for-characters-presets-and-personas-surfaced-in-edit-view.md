---
id: doc-81
title: >-
  Idea: last-used timestamps for characters, presets, and personas, surfaced in
  edit/view
type: other
created_date: '2026-08-22 15:15'
---


## What (owner request, 2026-08-22)

A "last used" date on user-facing entities — characters (personalities),
presets (LLM/TTS configs), personas — surfaced where the owner already looks
at them: the edit/view modes of the slash commands (dashboards, `view`
subcommands, plausibly `browse` list rows too).

## Why

Entity collections grow; a last-used date is the natural signal for "which of
these do I actually use" when curating, and it costs nothing to read at view
time once stamped.

## Design notes (scoping input, not decisions)

- **"Used" needs a per-entity definition**: character → a generation ran as
  it; persona → a turn was attributed to it (active persona at message time);
  LLM/TTS preset → a generation/synthesis actually consumed it (not merely
  selected in a dashboard). Pin each definition in the build spec.
- **Stamp, don't derive**: last-used is derivable from conversation-history
  rows for some entities, but a per-view/per-autocomplete MAX(created_at)
  query over large tables is the wrong cost shape; a stamped column reads
  free. Some candidate tables are dev↔prod sync-tracked, and last-used is
  exactly the high-frequency non-semantic write class from
  `.claude/rules/03-database.md` § Sync-Tracked Tables — **stamps must write
  via `$executeRaw` so they don't bump `@updatedAt`** and clobber the other
  env's genuine edits on the next LWW sync (the retention `lastActiveAt`
  precedent). Throttle writes (e.g. only bump when >N minutes newer) to keep
  write volume sane.
- New nullable columns need the null-semantics doc comment
  (state-machine pattern: null until first use post-migration).
- Rendering: a `Last used` field in the view embeds / dashboard summary
  sections; relative form ("3 days ago") is fine at render time since it is
  not part of any cached prompt surface.
- Adjacent prior art: `users.lastActiveAt` (retention stamps, `$executeRaw`),
  the autocomplete badge system (a "stale" badge is a possible follow-on,
  not in scope).

## Acceptance sketch

Each in-scope entity shows a last-used date in its view/edit surface; stamps
write on the defined "use" event without touching `updated_at`; entities
never used since the migration show a truthful "never"/absent state.
