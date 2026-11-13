---
id: TASK-1413
title: Extract before editing LLMInvoker.ts - file at 398/400 counted lines
status: To Do
assignee: []
created_date: '2026-11-13T00:09:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1403000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
services/ai-worker/src/services/LLMInvoker.ts sits at 398/400 on the ESLint max-lines metric (skipBlankLines + skipComments; wc -l is not the metric). Any substantive edit that adds counted lines fails lint until the file shrinks.

Why: the beta.244 caching unit (PR 2747) brought it to the ceiling; the file hosts model lookup, invocation and usage mapping in one module.

What: plan the extraction first - candidate seams: model instance-cache lookup, invocation flow, usage-metadata mapping - then land the edit in the same PR as the extraction.

Acceptance: pnpm lint green for ai-worker; no edit adds counted lines without a same-PR extraction.

Found in: PR 2747 Residue.
<!-- SECTION:DESCRIPTION:END -->
