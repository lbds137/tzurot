---
id: TASK-380
title: Voice purge folds already-gone voices into the deleted count
status: To Do
assignee: []
created_date: '2026-07-31 22:16'
labels:
  - 'size:S'
dependencies: []
priority: medium
ordinal: 380000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Why:** In `clearVoicesImpl` (`services/api-gateway/src/routes/user/voices.ts`, ~L434-456), a provider 404 increments `alreadyGone` and then `return`s — which RESOLVES the promise, so the outer `result.status === 'fulfilled'` branch increments `deleted` for the same voice. `alreadyGone` is computed and logged but never subtracted and never surfaced.

So `deleted` actually means "no longer present at the provider", not "deleted by this run", and the embed's "Deleted **N** cloned voices" over-claims by exactly the 404 count.

**LATENT, not currently firing.** Runtime-checked on dev 2026-07-31 22:13 (`deleted=170 alreadyGone=0 total=170 errors=0`) — the owner's purge deleted 170 real voices with zero 404s, so the observed count was honest. It needs a voice to disappear between `fetchAllTzurotVoices` and its delete: a concurrent purge from a second session, or provider-side expiry. That is also exactly when a user is most likely to be confused by the number.

**Fix shape:** don't count 404s as deletions. Either return a discriminated result from the batch mapper (`'deleted' | 'already-gone'`) and tally separately, or throw a sentinel the outer loop recognises. Then surface it — `Deleted **5** cloned voices (165 were already gone)` — because suppressing the 404 as a non-error was right, and hiding that it happened is what makes the count lie. The gateway response already has room: `{ deleted, total, errors? }` gains `alreadyGone`.

**Test gap that let it through:** the route tests cover the 404-is-not-an-error behaviour but assert on `errors`, never on `deleted` for a 404 run. A test with one 404 and one success should pin `deleted === 1`.

Surfaced 2026-07-31 while confirming smoke item 3 (#1752 follow-up).
<!-- SECTION:DESCRIPTION:END -->
