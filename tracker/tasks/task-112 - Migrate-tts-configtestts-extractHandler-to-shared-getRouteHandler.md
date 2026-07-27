---
id: TASK-112
title: 'Migrate tts-config.test.ts extractHandler to shared getRouteHandler'
status: To Do
assignee: []
created_date: '2026-05-21 00:00'
labels:
  - 'area:api-gateway'
  - 'area:voice'
  - 'area:db'
dependencies: []
ordinal: 112000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Migrate `tts-config.test.ts` `extractHandler` to shared `getRouteHandler`

**Why:** `services/api-gateway/src/routes/admin/tts-config.test.ts:106-115`. PR #1075 extracted `getAllRoutes()` to `expressRouterUtils.ts` but left the pre-existing `extractHandler` helper (25 call sites) unmigrated. The local `RouterLayer` interface stays alive solely to support `extractHandler`. **Fix shape**: replace `extractHandler(router, method, path)` calls with `getRouteHandler(router, method, path)` from `expressRouterUtils.js`; the return type widens from `(req: Request, res: Response) => Promise<void>` to `(...args: unknown[]) => unknown`, so each call site needs an `as` cast OR a thin local wrapper. Delete the local `RouterLayer` interface after migration. ~25-line mechanical touch. **Promote when**: next touching `tts-config.test.ts` for any reason, OR opportunistically during a wider test-utility cleanup pass. Surfaced 2026-05-21 by PR #1075 round-2 claude-bot review. Deferred 2026-05-21.
<!-- SECTION:DESCRIPTION:END -->
