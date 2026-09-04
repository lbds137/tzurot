---
id: TASK-344
title: MISSING_PERMISSIONS key-test result renders under the generic Invalid title
status: To Do
assignee: []
created_date: '2026-07-28 20:22'
updated_date: '2026-09-04 19:40'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 344000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /settings apikey test for a valid-but-scoped ElevenLabs key (missing_permissions 401 body) renders the ❌ "API Key Invalid" embed. The detailed permission list DOES surface in the embed body (parseElevenLabsPermissionError), so the user gets actionable info — but the title/description frame it as "failed validation" when the key is actually valid and merely under-scoped. Surfaced by the #1837 review as a non-blocking observation.
Fix shape: branch on errorCode === MISSING_PERMISSIONS in handleTestKey and render a distinct title/description ("valid key, missing permissions") — copy is owner-taste, propose wording at build time.
Acceptance: scoped-key test renders the distinct framing; INVALID_KEY/QUOTA_EXCEEDED unchanged; test pins the new branch.

**DECIDED 2026-08-14 (owner, TASK-599 digest): build the distinct framing - branch on MISSING_PERMISSIONS with a "Key valid - missing permissions" title/description; exact copy proposed at build for owner sign-off.**
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Owner already decided (2026-08-14) to build the distinct framing; not yet implemented. Evidence: `grep -n "MISSING_PERMISSIONS\|errorCode" services/bot-client/src/commands/settings/apikey/test.ts` → only `TIMEOUT`/`UNKNOWN` get special handling; `MISSING_PERMISSIONS` still falls to the generic `buildKeyInvalidEmbed`.
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
