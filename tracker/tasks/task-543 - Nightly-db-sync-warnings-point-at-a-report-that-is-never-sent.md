---
id: TASK-543
title: Nightly db-sync warnings point at a report that is never sent
status: Done
assignee: []
created_date: '2026-08-12 07:09'
updated_date: '2026-08-12 11:15'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 543000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the nightly owner-channel embed says "N warning(s) — full list in the report below", but nothing follows it. Owner-observed 2026-08-12 (screenshot: 6 warnings, no report).

Mechanism (verified): buildSyncSummary in services/bot-client/src/utils/dbSyncSummary.ts line 117 emits that sentence unconditionally whenever warnings exist. It is shared by two callers. The slash path (commands/admin/db-sync.ts) follows the embed with a chunked per-table report, so "below" is accurate there. The nightly path (services/NightlyDbSyncScheduler.ts) posts ONLY the embed, with a footer reading "Full per-table report: /admin db-sync" — so the warnings are counted and then never shown anywhere. The warning text is the only place the actual problem is described, which makes this a silent-failure surface: a failed deletion or a skipped row is announced as a number and nothing else.

Fix shape (owner preference stated): attach the warnings to the nightly post — a text-file attachment is the natural fit since warning count is unbounded and the embed description has a hard cap, which is exactly why the chunked report exists on the slash path. Alternative if an attachment is unwanted: parameterize buildSyncSummary so the nightly variant says "run /admin db-sync for the full list" instead of "below", which is at least honest but still leaves the owner without the detail at the moment they read it. Prefer the attachment.

Note the shared-caller trap: the sentence is emitted by a helper both paths call, so a fix that only edits the nightly scheduler will not remove the wrong text, and a fix that only edits the helper changes the slash path too. Pin both callers with tests.

Acceptance: the nightly sync post surfaces the actual warning text, and no message claims a report that the sending path does not send.
<!-- SECTION:DESCRIPTION:END -->
