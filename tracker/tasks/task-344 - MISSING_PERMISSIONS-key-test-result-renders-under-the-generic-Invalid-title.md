---
id: TASK-344
title: MISSING_PERMISSIONS key-test result renders under the generic Invalid title
status: To Do
assignee: []
created_date: '2026-07-28 20:22'
updated_date: '2026-08-04 13:55'
labels:
  - 'size:S'
  - 'area:bot-client'
dependencies: []
priority: low
ordinal: 344000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /settings apikey test for a valid-but-scoped ElevenLabs key (missing_permissions 401 body) renders the ❌ "API Key Invalid" embed. The detailed permission list DOES surface in the embed body (parseElevenLabsPermissionError), so the user gets actionable info — but the title/description frame it as "failed validation" when the key is actually valid and merely under-scoped. Surfaced by the #1837 review as a non-blocking observation.
Fix shape: branch on errorCode === MISSING_PERMISSIONS in handleTestKey and render a distinct title/description ("valid key, missing permissions") — copy is owner-taste, propose wording at build time.
Acceptance: scoped-key test renders the distinct framing; INVALID_KEY/QUOTA_EXCEEDED unchanged; test pins the new branch.
<!-- SECTION:DESCRIPTION:END -->
