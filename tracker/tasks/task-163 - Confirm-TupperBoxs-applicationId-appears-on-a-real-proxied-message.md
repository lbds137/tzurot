---
id: TASK-163
title: Confirm TupperBox's applicationId appears on a real proxied message
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:common-types'
  - 'size:S'
dependencies: []
priority: low
ordinal: 163000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Confirm TupperBox's applicationId appears on a real proxied message

**Why:** `KNOWN_PROXY_APP_IDS` (`packages/common-types/src/constants/proxyBots.ts`) includes TupperBox (`431544605209788416`) on an operator-confirmed public-app-id basis, but it's not yet observed in our message data. Safe failure mode: a wrong/typo'd id degrades a TupperBox-proxied human to `role="bot"` (reads as automation, not the person addressed) — NOT self-reply confusion (that needs `assistant`). **Confirm shape**: capture a real TupperBox-proxied reference's `applicationId` (log/probe) and verify it equals the constant. **Promote when**: a TupperBox user is available to test, or a TupperBox-proxied message appears in logs. Surfaced 2026-06-24 by PR #1321 round-3 claude-review.
<!-- SECTION:DESCRIPTION:END -->
