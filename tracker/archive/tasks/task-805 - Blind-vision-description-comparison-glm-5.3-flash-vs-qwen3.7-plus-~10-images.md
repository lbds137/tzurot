---
id: TASK-805
title: >-
  Blind vision-description comparison: glm-5.3-flash vs qwen3.7-plus (~10
  images)
status: To Do
assignee: []
created_date: '2026-08-29 00:04'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 805000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner asked (2026-08-27) whether 5.3 Flash beats Qwen 3.7 Plus for image description quality; answered honestly as "no head-to-head exists" and a ~10-image blind comparison was promised as a post-beta.209 follow-up. Never filed — mining run 2026-08-28 caught the leak.

What: run ~10 real prod-representative images (varied: art, screenshots, photos, text-heavy) through both models via the vision path, blind the outputs, owner judges pairs. Per the standing LLM-judging preference, default to the hybrid shape: LLM judge screens all pairs, owner blind-reviews flagged + a calibration sample.

Acceptance: a per-pair verdict table and a recommendation (keep flash / switch back / mixed) recorded where the free-default decision can cite it.

RESOLVED WITHOUT THE COMPARISON — owner decision 2026-08-29, verbatim: "I don't really care at this point, they're both good enough probably and they both censor some requests which is a bummer. however I can offer 5.3 Flash to my free users whereas I can't do that with Qwen."

DECISION: keep flash. The deciding axis is NOT description quality — the owner judges both adequate — it is that flash is offerable to free users on the z.ai coding plan and Qwen is not. The blind comparison this task describes would therefore answer a question that no longer drives the decision. Ruled out on merit, not dropped for cost: the work is well-specified and cheap, it simply cannot change the outcome.

Recorded rider, NOT owned by this task: the owner names CENSORSHIP on both models as the real irritant. Corroborated the same day in prod — z.ai returned a content-safety 400 on a user image (2026-08-29T05:43Z, deployment 3fdbfcfb, "System detected potentially unsafe or sensitive content"), which the vision fallback loop handled by advancing to openrouter/auto. That is a live quality problem on the shipped path, adjacent to TASK-770 (NSFW-block messaging reads as a moderation denial) rather than to this comparison. If it recurs at volume it wants its own task.
<!-- SECTION:DESCRIPTION:END -->
