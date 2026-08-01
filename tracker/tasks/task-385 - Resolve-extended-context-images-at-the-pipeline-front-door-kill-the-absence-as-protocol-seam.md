---
id: TASK-385
title: >-
  Resolve extended-context images at the pipeline front door (kill the
  absence-as-protocol seam)
status: To Do
assignee: []
created_date: '2026-08-01 02:49'
labels:
  - 'size:M'
dependencies: []
priority: medium
ordinal: 385000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Resolve extended-context images at the pipeline's front door instead of deriving them late.

**Why**: #1884 fixed the symptom (DownloadAttachmentsStep erased the absent-field sentinel DependencyStep gates on) but left the design that made it possible. `extendedContextAttachments` lives on `job.data.context` — the job's INPUT — and is resolved in DependencyStep via `?? deriveExtendedContextImages(...)`, i.e. absence is an unnamed protocol meaning "derive from the raw envelope".

Three costs, in order of confidence:

1. **CONFIRMED (the #1884 regression)**: any step that normalizes the field (`?? []`) between the front door and DependencyStep silently disables the feature. Nothing types or names the convention, so a correct-looking normalization breaks it. The seam test added in #1884 catches THIS instance; it does not stop the next one.

2. **CODE-READING, not runtime-confirmed**: derived images bypass DownloadAttachmentsStep entirely (derivation happens after it), so they reach vision as raw Discord CDN URLs rather than data URLs. This demonstrably worked pre-regression, so vision handles raw URLs fine — but they also skip `checkQueueAge`, which sits AFTER the short-circuit at DownloadAttachmentsStep.ts:142. A job that sat in a backed-up queue therefore fetches possibly-expired CDN URLs for extended-context vision with no age gate, while trigger attachments on the same job are protected.

3. **Conceptual**: mutating the job's input retroactively edits "what the job was asked to do" rather than recording "what this step produced". `GenerationContext` is the accumulator built for the latter (each field carries a `set by XStep` annotation); only DownloadAttachmentsStep and TTSStep bypass it. This is also why unit tests could not see the bug: fixtures construct inputs, and nobody tests what an input looks like after step 3 rewrites it.

**Fix shape**: resolve the field once, immediately after ConfigStep (which is where `maxImages` becomes available). By the time any later step sees `job.data.context`, the field is populated exactly as it was before the thin envelope. Then:
- DownloadAttachmentsStep's write-back becomes unconditionally correct (no absence to preserve) and can drop `filterOptional`
- its download + queue-age gate cover extended-context images, closing (2)
- DependencyStep's `?? deriveExtendedContextImages(...)` branch DELETES, and `deriveExtendedContextImages` moves to the resolving step
- absence stops carrying meaning anywhere in the pipeline

**Acceptance**: `rg 'extendedContextAttachments'` shows exactly one writer before DownloadAttachmentsStep; DependencyStep reads the field with no fallback; the #1884 seam test still passes (it should, unchanged — the behaviour it pins is the outcome, not the mechanism).

**Not urgent**: #1884 restores correct behaviour. This removes the class. Do it with the release behind us, on its own PR.
<!-- SECTION:DESCRIPTION:END -->
