---
id: TASK-707
title: 'release:premigrate should also verify dev migration status'
status: To Do
assignee: []
created_date: '2026-08-20 22:11'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 707000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: beta.205 shipped while dev was one migration behind (#2152 add_user_guild_infos merged 2026-08-19; the post-merge db:migrate --env dev step was skipped and nothing in the release flow re-checks dev). Dev ran the guild-info code against a missing table for a day, fail-soft; the owner discovered it via the db-sync schema-version gate (HTTP 500) after the release.

Fix shape: release:premigrate (packages/tooling, the release-range migration step) already resolves Railway creds and enumerates the range migrations for PROD — add a dev `migrate status` check to the same run and print a loud warning (or refuse without a flag) when dev has pending migrations from the range. Cheapest form: reuse the db:status plumbing with --env dev and diff against the range list.

Acceptance: running release:premigrate with a dev-pending migration in the range prints the pending list for BOTH envs; the happy path is unchanged.
<!-- SECTION:DESCRIPTION:END -->
