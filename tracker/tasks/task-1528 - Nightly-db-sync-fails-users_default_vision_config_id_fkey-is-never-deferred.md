---
id: TASK-1528
title: 'Nightly db-sync fails: users_default_vision_config_id_fkey is never deferred'
status: Done
assignee: []
created_date: '2026-11-24T12:41:00Z'
updated_date: '2026-11-24T16:35:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1525000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-11-24 nightly sync failed in prod (owner channel alert, HTTP 500, Postgres 23503 on users_default_vision_config_id_fkey). SYNC_DEFERRED_CONSTRAINTS in services/api-gateway/src/services/DatabaseSyncService.ts (grep SYNC_DEFERRED_CONSTRAINTS) lists the persona, llm, tts and memory_facts FKs but not the vision FK, although migration 20260627040007_vision_config_kind made it DEFERRABLE INITIALLY IMMEDIATE (migration.sql line 75). users sync before llm_configs (SYNC_TABLE_ORDER), so a user whose default_vision_config_id points at an llm_configs row new on the target fails immediately. The existing component test (DatabaseSyncService.component.test.ts, deferrable-constraints block) checks only that the schema marks the FK deferrable, not that the sync defers it. Root cause from code reading; the specific user and config row were not inspected.

What: add users_default_vision_config_id_fkey to SYNC_DEFERRED_CONSTRAINTS and its doc comment; add a component test mirroring "syncs a user with default_tts_config_id pointing at a TTS config from prod to empty dev" for default_vision_config_id; adjust the unit mock of deferrable rows if needed; sweep the stale syncTables.ts comments (the "all four users FKs deferred" claim and the SET CONSTRAINTS ALL DEFERRED wording). Consider a guard test that every DEFERRABLE FK in the schema is in SYNC_DEFERRED_CONSTRAINTS so the next deferrable FK cannot drift.

Acceptance: the new vision component test fails without the list entry and passes with it; a manual /admin db-sync succeeds in prod after release.
<!-- SECTION:DESCRIPTION:END -->
