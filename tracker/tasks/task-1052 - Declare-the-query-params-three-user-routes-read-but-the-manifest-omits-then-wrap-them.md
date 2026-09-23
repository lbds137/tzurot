---
id: TASK-1052
title: >-
  Declare the query params three user routes read but the manifest omits, then
  wrap them
status: To Do
assignee: []
created_date: '2026-09-23 01:10'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1046000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1036 made withManifestInput enforce every user route whose manifest entry declares a query schema, and its drift guard (services/api-gateway/src/routes/manifestInputCoverage.test.ts) derives the guarded set from that declaration. Three handlers read req.query keys their manifest entry never declares, so the guard cannot see them and the typed clients cannot express them: services/api-gateway/src/routes/user/conversationLookup.ts (discordMessageId), services/api-gateway/src/routes/user/usage.ts (period, cast to UsagePeriod with no validation), and handleGetDefaultModelConfig in services/api-gateway/src/routes/user/model-override.ts (slot via parseModelSlotQuery(res, req.query)). getRecentDiagnostics (admin/diagnostic.ts, userId + channelId) is the same shape and sits on the guard PENDING list.
Fix shape: declare each key in its packages/clients/src/routes/user manifest entry (matching what bot-client sends), rebuild clients + codegen:routes, wrap the handler in withManifestInput, and for getRecentDiagnostics remove it from PENDING once declared.
Acceptance: no user route handler reads req.query directly (git grep req.query under services/api-gateway/src/routes/user returns only tests), and PENDING is empty.
<!-- SECTION:DESCRIPTION:END -->
