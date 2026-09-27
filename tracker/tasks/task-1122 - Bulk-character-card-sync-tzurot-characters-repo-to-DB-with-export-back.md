---
id: TASK-1122
title: >-
  Bulk character card import from the tzurot-characters repo via the /character
  import path
status: To Do
assignee: []
created_date: '2026-09-27 10:23'
updated_date: '2026-09-27 10:24'
labels:
  - 'area:tooling'
  - 'size:L'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner request 2026-09-27, relayed by the Tzurot characters session. Character cards now live in the private repo lbds137/tzurot-characters (`cards/<Source>/<Name>/<slug>.json`, 152 cards). Loading them into the bot means pasting each card through the Discord UI, which blocks bulk work: adding a structural field to every card, renames, restructuring. First real use: the characters session fixes problems in existing cards in the repo, and this tool bulk-imports the fixes.

Owner rulings (2026-09-27, relayed by the characters session): (1) tzurot-characters is the SOURCE OF TRUTH; changes flow repo → DB only. No DB → cards export mode. (2) Reuse, don't reinvent: drive the SAME incremental-replace path the Discord `/character import` slash command already uses (`services/bot-client/src/commands/character/import.ts` → its api-gateway route and the schemas in `packages/common-types/src/schemas/api/personality.ts`), in bulk. No separate upsert or merge logic.

What: an ops command in `packages/tooling` (for example `pnpm ops characters:import --env <env> --dir <cards dir>`) that calls that shared path per card, with only these layers on top:
- Dry run by default: per card, report new, changed fields, or unchanged, computed against the current row. `--apply` writes through the shared path.
- Validate every card against the shared import schema before anything is written; stop the batch on any invalid card.
- Renames only through an explicit old→new slug map, never inferred.
- Ownership: a card whose slug belongs to another user (Lila's friend's Cynessa and Sister Camila) is refused unless explicitly allowed.
- First step when building: read the import route and confirm what "incremental replace" does with a field ABSENT from the card (left untouched, or cleared?), since the DB carries data no card has yet (below). Report that behaviour in the PR and pin it with a test; don't assume it.

Premises (dev DB, read-only, 2026-09-27): `definition_public` is false on all 217 personalities; 36 have tags, 70 have custom_fields, 1 has a birth date; Sera, Vaggi and Lila Elyona have personality_age in the DB although their cards lack it. Target (owner ruling 2026-09-27): dev first, then prod. Every batch runs dry-run then apply on dev, the owner checks the characters in the dev bot, and the same cards go to prod as a separate step.

Gate: ops tooling that writes to a live environment ships only after an end-to-end dev exercise with the effect observed in the service logs (00-critical § Testing).

Acceptance: a dry run over the whole cards dir against dev reports every card, and the reported changes match a hand check on three cards; one `--apply` of a card with one edited field changes exactly that field in dev, observed in the service logs; an invalid card stops the batch before any write.
<!-- SECTION:DESCRIPTION:END -->
