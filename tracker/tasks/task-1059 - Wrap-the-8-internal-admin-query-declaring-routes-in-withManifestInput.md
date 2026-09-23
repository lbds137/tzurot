---
id: TASK-1059
title: Wrap the 8 internal/admin query-declaring routes in withManifestInput
status: To Do
assignee: []
created_date: '2026-09-23 20:13'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 1053000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the manifest-input drift guard (services/api-gateway/src/routes/manifestInputCoverage.test.ts) is being extended to the internal and admin audiences on PR #2491 (review round 1). Of the 9 internal/admin routes whose manifest entry declares a query schema, only lookupPersonalityFromMessage is wrapped; the other 8 are seeded on the guard PENDING list: internal loadPersonalityInternal, recentUsers, getModels, getExportSmokeStatus; admin listDenylistEntries, setGlobalLlmConfigDefault, setGlobalLlmConfigFreeDefault, getAdminUsageStats. Their handlers read req.query unvalidated (e.g. admin/usage.ts, admin/llm-config.ts), so the manifest declaration is documentation only.
Fix shape: wrap each handler with withManifestInput(<audience>Routes.<id>, ...) and read the parsed query; check each declared schema against its callers (bot-client, ai-worker) first; keep bespoke 400 texts only where a test or caller depends on them; remove each id from PENDING as it is wrapped.
Acceptance: PENDING is empty; no internal/admin handler for these routes reads req.query directly.
Depends on: PR #2491 merging (it creates the extended guard).
<!-- SECTION:DESCRIPTION:END -->
