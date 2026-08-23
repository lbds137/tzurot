---
id: TASK-737
title: 'Vision media_not_found: expired Discord CDN URLs reach the vision fetch'
status: Done
assignee: []
created_date: '2026-08-23 01:58'
updated_date: '2026-08-23 21:56'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 737000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-735 prod sweep counted ~140 media_not_found vision failures in a week — the largest single category. Mechanism: Discord CDN attachment URLs are signed and expire; extended-context/re-vision paths can hand the vision pipeline a URL past its expiry, and the provider (or our fetch) then 404s. Distinct from the free-pool saturation the parent task measured (that half was ruled out 2026-08-22: openrouter/free dynamically routes across free vision models by design, so there is no chain on our side to diversify when its pool is empty).

Fix shape (needs grounding at build): refresh the attachment URL before the vision fetch — re-fetch the message via the Discord API to get a fresh signed URL (or use the refreshed proxy URL), rather than trusting a stored URL of arbitrary age. Check what the stored-description cache already absorbs: only UNdescribed old images should ever reach a fetch.

Acceptance: a vision request on an attachment whose stored URL is expired succeeds via a refreshed URL (or degrades to the documented presence note when the message itself is gone); media_not_found rate in prod logs drops accordingly.
<!-- SECTION:DESCRIPTION:END -->
