---
id: TASK-125
title: asActor / asSubject accept empty strings (defense-in-depth guard)
status: To Do
assignee: []
created_date: '2026-05-24 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:common-types'
  - 'size:S'
dependencies: []
priority: low
ordinal: 125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`asActor` / `asSubject` accept empty strings (defense-in-depth guard)

**Why:** `packages/common-types/src/routes/types.ts` smart constructors `asActor(id)` and `asSubject(id)` cast any string to the branded type, including `""`. Today the brands are only minted at the Discord interaction boundary (`interaction.user.id` is always a non-empty snowflake), so the risk is low. A one-line guard adds defense in depth against a future call site that forgets to validate before minting. **Fix shape**: `if (id.length === 0) throw new TypeError('asActor: id must be non-empty')` inside both smart constructors. ~4 LOC across both. **Promote when**: a new caller mints brands outside the Discord interaction boundary (e.g., from CLI args, request bodies), OR opportunistically alongside the next `types.ts` change. Surfaced 2026-05-24 by PR #1090 post-autosquash claude-bot review. Deferred 2026-05-24.
<!-- SECTION:DESCRIPTION:END -->
