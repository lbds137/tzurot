---
id: TASK-68
title: Relabel the BYOK key timestamp from last used to last validated
status: To Do
assignee: []
created_date: '2026-01-26 00:00'
updated_date: '2026-10-13 01:42'
labels:
  - 'area:db'
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
BYOK `lastUsedAt` tracking

**Why:** Nice-to-have, not breaking. Surfaced 2026-01-26 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner ruling 2026-10-12 (AskUserQuestion, backlog review Batch B owner calls): RELABEL: settings/apikey/browse.ts shows lastUsedAt as last used, but only wallet/testKey.ts stamps it, so it means last validated. Change the label (and any help text) to last validated. Real per-use tracking is ruled out: a write on every message for a nice-to-have.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `UserApiKey.lastUsedAt` exists in the schema and is stamped by `wallet/testKey.ts` (key-validation path only) — but nothing stamps it when the key is actually USED for a generation call in ai-worker; `userApiKey` never appears as a write target there. The tracking the task asks for (usage, not just validation) is still absent. Evidence: `git grep -n "lastUsedAt" services/api-gateway/src/routes/wallet/testKey.ts` → set on test-key validation only; `git grep -n "userApiKey" services/ai-worker` → read/pass-through only, no `lastUsedAt` write.
---
<!-- COMMENTS:END -->
