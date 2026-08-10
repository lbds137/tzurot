---
id: doc-71
title: 'Idea: Tag management UX — /tag browse/view/assign for bulk tagging'
type: other
created_date: '2026-08-10 01:47'
---

_Origin: owner, 2026-08-09, mid-smoke of doc-60. The S4 setup made the gap
vivid: a 143-character roster with only the per-character dashboard as the tag
write surface — one modal round-trip per character makes real adoption of tags
prohibitive._

## The key design unlock: tags need no ownership

Tags are plain strings on personality rows (doc-60 decision — no tag table, no
tag identity). So "tag management" never needs a tag owner or tag-level
permissions: every operation decomposes into per-character edits, and the
permission model is exactly "characters you can edit." A `/tag` group is
coherent with zero new schema.

## Proposed surface — `/tag` command group

- **`/tag browse`** — house browse pattern over the vocabulary (count-sorted,
  same aggregation `tagAutocomplete` uses, accessible pool only). Select → view.
- **`/tag view <tag>`** — member list for a tag (accessible pool; owned first).
- **`/tag assign <tag>`** — THE bulk write that makes tags adoptable: paginated
  multi-select string menu over the invoker's OWNED characters, 25 options per
  page (Discord hard ceiling on select-menu options), `max_values` = page size,
  apply per page-submit. 143 characters ≈ 6 pages for a full-roster sweep,
  vs. 143 dashboard round-trips today. Reuses the existing browse pagination
  machinery. Complement: `/tag remove <tag>` (same flow, inverse write).
- **`/tag bulk`** — modal with a paragraph text field of names/slugs (comma or
  newline separated) + tag(s) to apply. Discord modals are text-inputs-only —
  no autocomplete, no selects (verify current modal capabilities at build time;
  this constraint is from memory of the API, and Discord ships new component
  types). Serves "add these 12" without paging.
- **`/tag rename <from> <to>`** — bulk string swap across the invoker's owned
  characters; confirm-gated (destructive-shaped). Falls out of tags-are-strings.

Per-character write path already exists (gateway update accepts `tags`;
PersonalityTagsInputSchema does normalize/dedupe/cap) — the group is purely a
bot-client UX layer plus possibly a batched gateway endpoint if 25 sequential
PUTs per page feels wrong at build time.

## Constraints & considerations

- Select-menu ceiling is 25 options/page — pagination is mandatory, not chosen.
- Cache staleness after bulk writes: personality cache 5 min, autocomplete 60s —
  bulk flows should invalidate or the notice should set expectations.
- The 10-tags-per-character cap (TAG_LIMITS) applies per row on every write;
  bulk assign must surface per-character failures (cap hit) without aborting
  the batch.
- Interim operator stopgap (no feature): owner hands over a tag→characters
  mapping and the agent bulk-applies via dev DB / gateway API. If ever done on
  prod via raw SQL, set `updated_at = now()` explicitly so dev↔prod LWW sync
  propagates the change (client-level Prisma writes do this automatically; raw
  SQL bypasses `@updatedAt`).

## Relation

Sibling of doc-70 (tag-group CONVERSATION UX: count option, message-to-group).
Distinct clusters — management vs. conversation — but one council pass could
take both; both consume the doc-60 substrate. doc-67 (tag-scoped sharing)
arrives later on the same substrate and would inherit whatever browse/view
surface ships here.

## Promote when

Owner wants to actually organize the roster (the 143-character reality makes
this near-term); the interim stopgap covers dev smoke needs meanwhile.
