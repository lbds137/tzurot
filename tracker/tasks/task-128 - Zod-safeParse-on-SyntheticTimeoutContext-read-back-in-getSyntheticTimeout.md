---
id: TASK-128
title: Zod safeParse on SyntheticTimeoutContext read-back in getSyntheticTimeout
status: To Do
assignee: []
created_date: '2026-05-29 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: low
ordinal: 128000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Zod `safeParse` on `SyntheticTimeoutContext` read-back in `getSyntheticTimeout`

**Why:** `services/bot-client/src/services/MultiTagPersistence.ts` `getSyntheticTimeout` casts the parsed JSON marker straight to `SyntheticTimeoutContext` (`JSON.parse(raw) as SyntheticTimeoutContext`) with no runtime schema check. Today this is safe: we write the marker ourselves and the 30-min TTL keeps any cross-deploy shape drift transient. The latent risk is schema evolution — if a future PR adds a **required** field to `SyntheticTimeoutContext`, markers written by old code parse successfully (the cast doesn't validate at runtime) and the consumer sees `undefined` for the missing field, potentially producing a surprising `sendResponse` call or a Discord API error rather than a clean null-and-skip. **Fix shape**: a one-time `z.object({...}).safeParse(raw)` returning `null` on failure inside `getSyntheticTimeout` eliminates the class entirely (the existing catch already handles malformed JSON; this extends it to structurally-valid-but-wrong-shape). ~10 LOC + schema. **Promote when**: `SyntheticTimeoutContext` next gains a required field, OR opportunistically alongside the next `MultiTagPersistence` change. Surfaced 2026-05-29 by PR #1117 round-3 claude-bot review (advisory, non-blocking). Deferred 2026-05-29.
<!-- SECTION:DESCRIPTION:END -->
