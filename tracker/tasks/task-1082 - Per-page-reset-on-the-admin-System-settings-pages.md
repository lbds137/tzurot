---
id: TASK-1082
title: Per-page reset on the admin System settings pages
status: To Do
assignee: []
created_date: '2026-09-24 16:26'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 1075000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ruling 2026-09-24 (doc-72 PR B, "Build as described"): admin keeps per-page reset, and every settings page gets a Reset page button. The 8 System pages (systemSettingsConfig.ts, stored in admin_settings.system_settings) cannot take it in PR B: the system-settings PATCH (services/api-gateway/src/routes/admin/systemSettings.ts) parses its body with UpdateSystemSettingsRequestSchema, whose patch is SystemSettingsSchema.partial().strict() (packages/common-types/src/schemas/api/systemSettings.ts). A key can be omitted but not cleared, so there is no wire form that returns a stored key to its registry fallback. Whether each field schema rejects null was read, not probed.
Dependent on: doc-72 PR B landing the page-reset mechanism this task plugs into.
Fix shape: let the system-settings PATCH accept null for a key to mean delete it from the bag (the value then resolves to the registry fallback in systemSettingsRegistry.ts), run the existing coherence and range validation over the resulting bag, write the audit row with newValue null; then wire the System pages into the PR B page-reset mechanism. Deleting the key, not writing the fallback value, keeps a reset setting tracking future fallback changes.
Acceptance: every System page renders Reset page; confirming returns every row on that page to its registry fallback in one PATCH; a gateway test pins null-deletes-key and the coherence check on the post-delete bag.
<!-- SECTION:DESCRIPTION:END -->
