---
id: TASK-623
title: >-
  Watch: assistant reply previews now rely on prompt-instruction guards against
  self-continuation
status: To Do
assignee: []
created_date: '2026-08-15 22:23'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 623000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2108 removed the structural guard (empty dedup stub for role=assistant references) that prevented the model from treating a fragment of its own quoted text as a continuation seed. The replacement is two prompt-level instructions (OUTPUT_CONSTRAINTS + the contextual_references instruction). Deliberate, owner-directed trade - it fixes the contentless-pointer prod bug - but a prompt-instruction guard can degrade under context pressure in ways a structural one cannot (round-2 reviewer observation).

What to watch: any prod report of a character continuing or regurgitating its own quoted line when a user replies to the character message (the reply renders a 100-char preview now).

Acceptance: if the failure mode appears, the fix is a bounded structural mitigation (e.g. cap or paraphrase-frame the assistant preview), not re-blanking the preview; if nothing appears within a few releases of the reply-preview feature being exercised, archive as watched-and-clear.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. named, still-live observable (any prod report of a character continuing/regurgitating its own quoted line); the structural guard is confirmed still removed and replaced only by prompt instructions, matching the task's premise exactly. Evidence: `git grep -n contextual_references services/ai-worker/src/services/prompt/HardcodedConstraints.ts` → the prompt-level guard is present (line 121) as described; no structural dedup stub found back in place.
---
<!-- COMMENTS:END -->
