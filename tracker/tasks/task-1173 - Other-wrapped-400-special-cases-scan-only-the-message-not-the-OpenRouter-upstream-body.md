---
id: TASK-1173
title: >-
  Other wrapped-400 special cases scan only the message, not the OpenRouter
  upstream body
status: To Do
assignee: []
created_date: '2026-10-04 22:40'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1164000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2572 review (non-blocking): detectSpecialCases in services/ai-worker/src/utils/apiErrorParser.ts now scans error.error.metadata.raw for the PROVIDER_CONTENT_REFUSED group only. The sibling wrapped-in-400 hoists (INVALID_MODEL_ID_PATTERN, the z.ai model-not-found code/message pair) still read error.message alone. If OpenRouter ever delivers either of those only inside metadata.raw, the error classifies BAD_REQUEST and the quota fallback dead-ends exactly as TASK-1161 did. No specimen yet, and the file policy is to broaden only with per-provider evidence.
What: when a prod log shows a 400 BAD_REQUEST whose err.error.metadata.raw carries a model-not-found or invalid-model wording, extend the raw scan to that group (narrowly, same shape as the PROVIDER_CONTENT_REFUSED scan) with a real-shape test and negative control.
Signal to watch: ai-worker logs errorCategory=bad_request with a metadata raw body naming an unknown or unpublished model.
<!-- SECTION:DESCRIPTION:END -->
