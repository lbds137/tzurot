---
id: TASK-771
title: Sweep the users table for webhook-identity rows and pin the provisioning guard
status: To Do
assignee: []
created_date: '2026-08-25 18:00'
labels:
  - 'area:identity'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 771000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-08-25 retention report listed the webhook identity Dionysus | (bot suffix) — Discord id 1452360456152027196, snowflake minted ~2025-12-21 — as a purge-eligible USER (no characters, no usage_logs, last_active 2026-02-18). Code-read mechanism (not runtime-confirmed): getOrCreateUser has skipped isBot===true callers since c88ae5b7c (2025-12-20), but the guard fails open when a caller passes isBot undefined, and the extended-context path mishandled our-authored webhook messages until 317777144 (2026-06-16, the Bug A/B normalization) — the row activity window (through 2026-02-18) falls inside that vulnerable span. Entry path is closed today; the residue and the fail-open guard remain.

Fix shape: (1) one-off prod sweep for the class — SELECT discord_id, username FROM users WHERE username LIKE the webhook-suffix shapes (both the legacy pipe and current middle-dot separators); expect ~1 row; (2) decide disposal — the retention purge erases it naturally (no person, no notice owed) or delete it as junk directly; (3) harden getOrCreateUser: treat isBot undefined as refuse-or-verify rather than fail-open, or add a username-shape refusal for our own webhook suffix, with a seam test.

Acceptance: sweep run and every webhook-shaped row dispositioned; a test pins that a webhook-authored identity (isBot undefined) cannot be provisioned.
<!-- SECTION:DESCRIPTION:END -->
