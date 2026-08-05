---
id: TASK-74
title: Reconsider hard-fail vs soft-error for attachment download failures
status: To Do
assignee: []
created_date: '2026-04-24 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Reconsider hard-fail vs soft-error for attachment download failures

**Why:** PR #889 changed semantics: old `AttachmentStorageService.downloadAndStore` used `Promise.allSettled` and returned the original Discord CDN URL as fallback on per-attachment failure (soft-error; job continued with broken URL); new `DownloadAttachmentsStep.downloadAll` throws on any failure and fails the whole job (hard-fail). New behavior is arguably more correct (old soft-error handed LLM a dead URL that produced weird responses), but it's a visible user-facing change — transient CDN hiccups that were previously silent now produce classified async errors. **Watch-item**: if users report "attachments dropped without warning" → "job failed visibly" complaints, reconsider partial-failure soft-error (continue with successful attachments, surface non-fatal warning for failed ones). **Fix shape when needed**: change `downloadAll` to keep partial successes, attach failure metadata to generation context, surface "couldn't load N of M attachments" notice. **Why deferred today**: no observed user complaints; visible errors easier to diagnose than silent corruption. Surfaced 2026-04-24 by PR #889 Round 5 claude-review. Deferred 2026-04-24.
<!-- SECTION:DESCRIPTION:END -->
