---
id: TASK-640
title: Speaker disambiguation degrades silently when discordUsername is missing
status: To Do
assignee: []
created_date: '2026-08-17 05:00'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 640000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: buildDisambiguatedDisplayName (services/ai-worker/src/services/prompt/MessageFormatters.ts:24-40) falls back to the bare persona name when discordUsername is absent, so a name-colliding speaker renders indistinguishable from the character in the <from> tag, with no log line anywhere. The one diagnostic that covered this class -- detectNameCollision logger.error in prompt/PromptLogger.ts:105 -- is, since TASK-622 (PR 2123), reachable only from the eval-only legacy arm (services/ai-worker/src/services/eval/legacyPromptAssembly.ts:181), so nothing fires on the production path.

Not a TASK-622 regression: the fallback and its missing diagnostic both predate it. TASK-622 is what made the gap visible, by removing the production caller of the one function that logged it.

Fix shape: emit a warn from buildDisambiguatedDisplayName (or its caller in PromptBuilder.buildHumanMessage) when the name collides with personalityName AND discordUsername is empty -- log personalityId only, never the persona name (00-critical PII rule). Then decide whether detectNameCollision still earns its place or folds into the legacy arm.

Acceptance: a collision with no discordUsername produces exactly one warn carrying personalityId and no user-identifying fields, pinned by a unit test.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. real cost (a name-colliding speaker renders indistinguishable from the character, with no diagnostic anywhere on the production path). `buildDisambiguatedDisplayName` still has no warn/log path for the collision-with-no-username case. Evidence: `sed -n '1,50p' services/ai-worker/src/services/prompt/MessageFormatters.ts` → function still silently falls back to `activePersonaName` with no logger call.
---
<!-- COMMENTS:END -->
