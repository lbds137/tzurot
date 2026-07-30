---
id: TASK-366
title: 'Enrichment pipeline has no traceability: paid work can be discarded silently'
status: To Do
assignee: []
created_date: '2026-07-30 23:08'
labels:
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 366000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-30 by TASK-364. The owner named observability as the top finding: "if it is not clear what went wrong / how this happened, that is a problem."**

Four vision calls ran, succeeded, took 47.8s, and their output was discarded before reaching the model. ZERO log lines recorded the discard. The only detector in the system was the owner reading Discord and noticing the character could not see the images.

**Smell:** enrichment results (vision descriptions, transcriptions, link fetches) are produced by one stage and consumed by another with no assertion — in code OR in logs — that produced work was actually consumed. A renderer that drops them looks identical to a producer that never ran.

**Fix shape (two parts):**
1. **Runtime**: warn-log when an enrichment result reaches a renderer and is not emitted — specifically, when a deduped reference carries preprocessed attachments whose descriptions are not rendered. Include jobId + count so it correlates with the producing job.
2. **Test (council 3/3 recommendation, and their answer to "what test catches the CLASS")**: enrichment-traceability. Mock the vision boundary to return sentinel strings; assert the sentinels appear in the FINAL prompt for every cell of the matrix (deduped x not-deduped) x (live x stored). Assert the pairing — vision called N times AND its N outputs rendered. No field enumeration, no allowlist, robust to refactors, and it directly encodes the economic invariant: **paid work must appear**.

Kimi K3: "you do not have a test-quantity problem, you have an oracle-placement problem." Line coverage was green through both bugs of this class.

**Note the existing rule already half-covers this**: `02-code-standards.md` requires a wiring test per multi-module flow mocking only the external boundary. This flow either has no such test or it never exercises a deduped image reference. Applying the existing rule to the dedup input matrix is step zero.
<!-- SECTION:DESCRIPTION:END -->
