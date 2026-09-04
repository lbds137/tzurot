---
id: TASK-426
title: >-
  Route AIJobProcessor STT key-resolution failures through
  NoApiKeyAvailableError if noisy
status: To Do
assignee: []
created_date: '2026-08-04 07:54'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 426000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: reviewer observation on the TASK-423 fix — AIJobProcessor.processAudioTranscriptionJobWrapper has the same catch-and-warn-with-stack shape for BYOK STT key resolution, deliberately left warn-level: SttResolver.applyCascade only routes to mistral/elevenlabs when the user EXPLICITLY configured a BYOK provider, so a failure there is closer to a real anomaly (e.g. revoked key with a stale default-provider setting) than the every-user probe in AuthStep.
Fix shape: if prod logs show this line recurring as routine noise, branch on NoApiKeyAvailableError the same way AuthStep does (debug for the typed case, warn with stack otherwise).
Promote when: a prod log sweep shows the STT wrapper warn recurring for the same user/provider as routine traffic rather than a one-off anomaly.
Acceptance: expected no-key STT fallbacks stop emitting stacks; genuine resolution failures still warn.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. named trigger (a prod log sweep showing the warn recurring as routine noise) has not been evaluated in this read-only pass; the code is still unconditional `logger.warn` with `err: error` regardless of error type. Evidence: `sed -n '216,245p' services/ai-worker/src/jobs/AIJobProcessor.ts` → catch block still logs `warn` unconditionally, no branch on `NoApiKeyAvailableError`.
---
<!-- COMMENTS:END -->
