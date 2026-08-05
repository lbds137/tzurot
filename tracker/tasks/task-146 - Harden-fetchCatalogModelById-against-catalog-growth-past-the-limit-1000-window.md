---
id: TASK-146
title: >-
  Harden fetchCatalogModelById against catalog growth past the limit: 1000
  window
status: To Do
assignee: []
created_date: '2026-06-15 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 146000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Harden `fetchCatalogModelById` against catalog growth past the `limit: 1000` window

**Why:** `fetchCatalogModelById` (`services/bot-client/src/utils/modelCatalog.ts`) resolves an exact slug by fetching up to 1000 catalog candidates (substring match on the gateway) and pinning the exact id. With ~340 OpenRouter models today the ceiling is comfortable, but if the catalog grows well past 1000 with many short common slugs, the exact match could be silently truncated out of the candidate window. **Fix shape**: NOT a dedicated `GET /models/:id` gateway route — that was evaluated and rejected because `fetchCatalogModelById` relies on `fetchModelCatalog`'s OpenRouter+z.ai _merge_ (it must find z.ai-only models like `glm-5.2` and attach z.ai docs to `both`-source cards); an OpenRouter-only by-id route would fragment that. Instead raise the limit, or add a merge-aware bounded exact-match. **Promote when**: the OpenRouter catalog approaches ~1000 models, or a by-id lookup miss is observed in prod. Surfaced 2026-06-15 by PR #1217 round 3; fix-shape corrected 2026-06-15 (PR #1221 evaluation).
<!-- SECTION:DESCRIPTION:END -->
