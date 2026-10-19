---
id: doc-113
title: 'Idea: Multi-select batch actions in browse lists'
type: other
created_date: '2026-10-19 03:41'
---

## Why

Lila asked the Machloket Client and Tzurot sessions to find where multi-select would make Tzurot's UX better (2026-10-18). Today every select in the bot takes one pick (`services/bot-client/src/utils/browse/selectMenuBuilder.ts` sets `setMaxValues(1)`). The modal toolkit (`utils/modal/toolkit.ts`) already supports `maxValues`, but no caller passes it. Browse lists that act on items (delete, lock, clear, remove) take 2-3 interactions per item.

## Members (owner-picked)

- TASK-1252: memory facts, forget or lock several facts
- TASK-1253: memory browse/search, delete or lock hand-picked memories
- TASK-1254: character alias browse, remove several aliases
- TASK-1255: preset and TTS override browse, clear several overrides
- TASK-1256: deny browse, remove several denylist entries

## Shared shape

- Keep the existing one-pick select, which opens one item. Add a "Select several" button that swaps in a separate multi-select (min 1, max = page size, at most 25, the page cap). This follows the Machloket Client's read that a multi-select submits when it closes, not on a single tap, so reusing the open-one menu would slow the common path. Verify that read against the Discord docs before building on it.
- The batch confirm lists every affected item. The result names per-item failures; never report all-or-nothing on a partial run.
- Each member needs a gateway batch route, or a bot-side loop with per-item results: every current API call takes one id. The first member built extracts the shared helper into `utils/browse/`, and the rest reuse it (`04-discord.md` § Shared Utilities table gets the new row).
- Client side: Machloket renders message multi-selects (FancySelect) and modal checkbox groups today. On phones the list opens over the message until its M2 lands.

## Ruled out

- **System settings LIST fields as checkboxes.** Lila's ruling, 2026-10-18: "only do it if it's a bounded set. comma separated lists probably don't qualify if it's something open ended like character slugs". All three list settings hold personality slugs, an open-ended set: `archiveSplitRenderPersonalities`, `archivePromotionOptOutPersonalities` and `recentDaysDigestPersonalities` (`packages/common-types/src/schemas/api/systemSettingsRegistryOperations.ts`, every `control: 'list'` entry). They stay typed lists. Revisit if a list setting over a fixed enum is ever added.
- Read-only or single-session browses: `/inspect`, `/models`, `/shapes`, `/character` and `/persona` browse (each opens one dashboard), dashboard edit menus (one modal per interaction), and `/admin servers` (leaving a server stays one at a time).

