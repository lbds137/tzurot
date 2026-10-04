---
id: TASK-1171
title: >-
  Tell guests when the z.ai piggyback is closed instead of silently swapping
  models
status: To Do
assignee: []
created_date: '2026-10-04 22:04'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1163000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1160 root cause (prod logs 2026-10-04): every guest turn since at least 14:18Z logged ZaiFreeTierAdmission "z.ai free tier closed — plan window past the headroom threshold" consumedPct=95 headroomPercent=75 resetAt=2026-10-08T02:22Z, then guestModeOverrides "z.ai free-tier denied" reason=headroom. Denial is silent by design (services/ai-worker/src/services/ZaiFreeTierAdmission.ts), so a guest who picked GLM 5.3 Flash sees a different model answer with no explanation, and the owner read it as a bug. The deny reason does not reach the reply payload today (git grep for denyReason / freeTierDenied in bot-client: nothing).
What: carry the admission deny reason (or just a closed flag) from guestModeOverrides through the job result to the bot-client footer, and render a short note on guest replies when the selected piggyback model was skipped.
Acceptance: a guest turn denied by any of the five gates shows the note; an admitted turn does not; seam test asserts the reason crosses the job-result seam.
Owner question: Should guest replies carry a footer note when the GLM 5.3 Flash piggyback is closed, and if so should it name the reason (plan busy, daily share used) or only say a free fallback model answered?
Recommendation: yes, a generic note (free model temporarily unavailable, answered by a fallback) without the reason — the reasons expose plan-internal state guests cannot act on.
<!-- SECTION:DESCRIPTION:END -->
