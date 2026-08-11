---
id: doc-52
title: >-
  Idea: Time-range filtering on the purge/delete commands — `before`/`after`,
  and autocomplete instead of fixed choices (owner request 2026-07-26)
type: other
created_date: '2026-07-28 11:11'
---

## Time-range filtering on the purge/delete commands — `before`/`after`, and autocomplete instead of fixed choices (owner request 2026-07-26)

**Owner wants this NEXT, immediately after the `/history purge` propagation fix (#1796)** — verbatim: _"I wanna strike while the iron is hot. Otherwise, I'll get... this will get buried, and nobody will find it again."_ Motivation: be able to delete memories for a specific period instead of nuking a character's whole store.

**Two joined problems, both grounded 2026-07-26.**

1. **`timeframe` is recency-only — literally half a range.** `parseTimeframeFilter` (`routes/user/memoryHelpers.ts:57`) resolves to `{ gte: cutoffDate }`, i.e. `createdAt >= now - duration`. So `/memory delete` can only ever delete the NEWEST memories; there is no "older than", no range. That is backwards from the common need (clear out old, keep recent).
2. **The flexible parser already exists and is already used elsewhere.** `Duration.parse` wraps the `parse-duration` library (`3 months`, `2 weeks`, `1h30m`) and backs the free-form settings-cascade max-age. The `timeframe` options just don't expose it — they are locked behind `addChoices`, a fixed 5-item dropdown.

**Design (agreed direction, two calls still open).** `addChoices` and `setAutocomplete(true)` are **mutually exclusive** on a Discord option, but autocomplete subsumes both: empty input returns the current presets, typed input is parsed live and echoed back as the suggestion. That gives premades + free-form in ONE option — no "custom" second parameter, no invalid combinations. **The suggestion IS the format documentation**: typing `2026-07-01` suggests `2026-07-01 00:00 UTC`, `30d` suggests `30 days ago — 2026-06-26`, garbage suggests the accepted forms. That dissolves the "users won't know the format" problem for dates without any messaging the user has to read first.

- Add `before` / `after` (either alone = open-ended; both = range) to `/memory delete` and `/history purge`.
- Inverted range surfaces in the EXISTING preview ("0 memories match — your dates are reversed") rather than as a hard error; the preview-then-token flow is already the right surface, and a hard error for a legal-but-empty filter is worse than showing the zero.
- `before X` means strictly `< X`, so a date-only `before 2026-07-01` excludes July 1st. Keep the strict semantics and let the suggestion make the instant visible rather than silently rounding.

**Scope — 4 sites use static time choices**: `admin usage` (`USAGE_TIMEFRAME_CHOICES`), `memory delete` (`DELETE_TIMEFRAME_CHOICES`), and `memory fresh|incognito enable` (`MODE_TIMEFRAME_CHOICES` ×2). One shared parse-and-echo autocomplete handler with per-command preset lists — NOT one identical handler: fresh/incognito are session durations with a `forever` special value, not historical windows.

**Open calls (owner, asked 2026-07-26, not yet answered):** (a) do `before`/`after` REPLACE `timeframe` on `/memory delete` (`after: <date>` subsumes it — cleaner, but changes a command in active use) or sit alongside it? (b) resolve dates in the user's stored `users.timezone` (default `UTC`) or keep everything UTC?

**Rider defect found while grounding**: `/memory delete`'s option description reads `'Only delete memories from this time period (e.g., 7d, 30d, 1y)'`, which promises free-form input — but the option is `addChoices`, a locked dropdown. The description was written for a free-form field that never shipped. Fixed for free if this lands; worth fixing regardless.

**Also worth surfacing to users**: `/memory delete` (batch, filtered, skips locked, preview-then-confirm) already exists and the owner did not know it did. Whatever ships here should consider whether that command is discoverable enough — see `doc-25`.

