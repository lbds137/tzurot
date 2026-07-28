---
id: TASK-332
title: >-
  ContextAssembler userName fallback crashes first-provision (snowflake persona
  name)
status: To Do
assignee: []
created_date: '2026-07-27 00:00'
updated_date: '2026-07-28 10:53'
labels:
  - 'area:ai-worker'
  - 'area:identity'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 332000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-27 (#1810 contract-fixture cascade) — **ContextAssembler's `userName ?? userId` fallback crashes first-provision for a nameless envelope**: `getOrCreateUser(jobContext.userId, jobContext.userName ?? jobContext.userId, …)` makes the default persona's name the bare snowflake, which the `personas_name_not_snowflake` DB CHECK rejects (23514) — the create fails instead of degrading. Unreachable while bot-client always ships `userName` (the contract fixtures now model that), but the fallback is a landmine, not a degradation path. **Fix shape**: on the missing-username path, fall back to the shell-placeholder formula (`User <id>`) or make `userName` required in the envelope schema. **Promote when**: a `23514 personas_name_not_snowflake` appears in prod logs, or any envelope-schema change makes `userName` optional-in-practice. Related un-DRY note: `UserReferencePatterns.ts` and `inspect/lookup.ts` embed their own `\d{17,20}` fragments (matching the canonical range today) — consolidate onto `DISCORD_SNOWFLAKE` in the same pass.

**Why:** The DB CHECK turned a bad-name bug into a crash — good guard, wrong recovery.
<!-- SECTION:DESCRIPTION:END -->
