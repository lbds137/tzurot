---
id: TASK-113
title: >-
  Tighten users.default_llm_config_id and default_tts_config_id to NOT NULL
  post-Phase-5b
status: To Do
assignee: []
created_date: '2026-05-21 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:db'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Tighten `users.default_llm_config_id` and `default_tts_config_id` to NOT NULL post-Phase-5b

**Why:** `prisma/schema.prisma:26-27`. Both columns are `String?` (nullable). They predate Phase 5b's atomic user-creation work (which made `default_persona_id` NOT NULL). With users now created via a deterministic CTE that has access to system free-defaults, these two columns could be backfilled and tightened too — eliminating defensive `?? fallback` in `LlmConfigResolver` / `TtsConfigResolver`. **Fix shape**: (a) migration to backfill any existing NULL rows with the system free-default config id; (b) `ALTER COLUMN ... SET NOT NULL`; (c) update `schema.prisma` to drop the `?`; (d) audit resolver code to remove no-longer-reachable null branches. ~50-80 LOC + migration. **Why deferred**: no bug today — the resolvers handle null correctly, and the cascade design tolerates user-tier null gracefully. Tightening is for invariant clarity + dead-code removal, not bug fix. **Promote when**: next user-identity audit, OR alongside the syncTables comment fix above (same scope), OR if a new config-cascade bug traces to ambiguous null semantics. Surfaced 2026-05-21 by Schema Audit. Deferred 2026-05-21.
<!-- SECTION:DESCRIPTION:END -->
