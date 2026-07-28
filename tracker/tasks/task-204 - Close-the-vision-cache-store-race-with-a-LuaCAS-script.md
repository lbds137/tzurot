---
id: TASK-204
title: Close the vision-cache store race with a Lua/CAS script
status: To Do
assignee: []
created_date: '2026-07-04 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:redis'
  - 'size:S'
dependencies: []
priority: low
ordinal: 204000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Close the vision-cache store race with a Lua/CAS script

**Why:** `VisionDescriptionCache.store()`'s read→decide→setex is non-atomic; two concurrent stores for the same image race to last-writer-wins (documented in the file; bounded to one 1h TTL cycle, rare under the per-request describe flow). Deferred from #1485 because no Lua-capable Redis test infra exists. **Fix shape**: CAS-style Lua promotion script + a Lua-capable test harness (or integration-tier coverage). **Promote when**: vision-description quality becomes a support complaint (beta.147 release-review trigger). Surfaced 2026-07-04 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
