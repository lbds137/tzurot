---
id: TASK-575
title: >-
  releaseReconcile ai-worker caller skips the typed client so the schema
  strictness rationale is unwired
status: To Do
assignee: []
created_date: '2026-08-12 22:39'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 575000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2038’s PR body justifies the REQUIRED newestPrerelease field by client-side validation failing at most one hourly sweep during rolling deploys - but the only caller (ai-worker jobs/releaseReconcile.ts:32-44) is a raw fetch parsing the body as unknown, never validating against ReleaseReconcileResponseSchema; the typed client route exists (packages/clients routes/internal.ts:181) and is unused, and the conformance fixture skips the route. No behavior bug today; the recorded design rationale rests on a validation path that is not wired.

Fix shape: switch the caller to the typed client (or unskip the conformance fixture and document why raw fetch).

Source: 2026-08-12 review, health F8 CONFIRMED.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. real cost it prevents (recorded design rationale — REQUIRED field validation — rests on a path that isn't wired; a schema break would surface at parse time via `unknown`, not the intended validation). Caller is still a raw `fetch` parsing as `unknown`. Evidence: `sed -n '25,44p' services/ai-worker/src/jobs/releaseReconcile.ts` → still raw `fetch` + `response.json(): unknown`, no `ReleaseReconcileResponseSchema` or typed client import.
---
<!-- COMMENTS:END -->
