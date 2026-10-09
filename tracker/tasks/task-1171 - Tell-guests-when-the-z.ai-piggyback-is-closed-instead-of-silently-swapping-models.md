---
id: TASK-1171
title: >-
  Tell guests when the z.ai piggyback is closed instead of silently swapping
  models
status: Done
assignee: []
created_date: '2026-10-04 22:04'
updated_date: '2026-10-09 02:03'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1163000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1160 root cause (prod logs 2026-10-04): every guest turn since at least 14:18Z logged ZaiFreeTierAdmission "z.ai free tier closed — plan window past the headroom threshold" consumedPct=95 headroomPercent=75 resetAt=2026-10-08T02:22Z, then guestModeOverrides "z.ai free-tier denied" reason=headroom. Denial is silent by design (services/ai-worker/src/services/ZaiFreeTierAdmission.ts), so a guest who picked GLM 5.3 Flash sees a different model answer with no explanation, and the owner read it as a bug. The deny reason does not reach the reply payload today (git grep for denyReason / freeTierDenied in bot-client: nothing).
Owner decision (2026-10-04): GENERIC note, no reason. Shape approved from the preview: a small footer line such as "GLM 5.3 Flash is temporarily unavailable, so a fallback free model answered." The deny reason (headroom, quota, kill-switch, cooldown, disabled) is NOT shown to guests: it exposes plan-internal state they cannot act on.
What: carry a piggyback-skipped flag (not the reason) from guestModeOverrides through the job result to the bot-client footer, and render the generic note on guest replies when the selected piggyback model was skipped. Name the selected model in the note from the request, not a hardcoded string.
Acceptance: a guest turn denied by any of the five gates shows the note; an admitted turn and a non-guest turn do not; the note text never contains the deny reason; seam test asserts the flag crosses the job-result seam.
<!-- SECTION:DESCRIPTION:END -->
