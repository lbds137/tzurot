---
id: TASK-189
title: Delete-guard read-then-act transaction hardening
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:db'
  - 'size:S'
dependencies: []
priority: low
ordinal: 189000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Delete-guard read-then-act transaction hardening

**Why:** The admin config delete guard reads `adminSettings.findUnique` then deletes as two steps — a concurrent `set-default` between them could let a just-promoted default be deleted (FK `onDelete:SetNull` bounds the blast radius; admin-only endpoint). Same read-then-act class: `setAsDefault`/`setAsFreeDefault` no longer pre-validate the config exists (the route layer does via `findGlobalConfigOrSendError`), so a config vanishing in the race window surfaces as a Prisma FK-500 rather than a clean 404 — a deliberate, JSDoc'd error-quality regression for the narrow race. **Fix shape**: wrap the guard + delete in a transaction if admin-endpoint concurrency ever matters. (The null-singleton-row branch is now unit-tested — only the transaction hardening remains.) **Promote when**: admin concurrency becomes a concern, or opportunistically when next touching the delete handler. Surfaced 2026-06-29 by PR #1388 (P3-S3) claude-review (non-blocking).
<!-- SECTION:DESCRIPTION:END -->
