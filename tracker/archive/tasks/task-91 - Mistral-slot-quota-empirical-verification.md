---
id: TASK-91
title: Mistral slot quota empirical verification
status: To Do
assignee: []
created_date: '2026-05-02 00:00'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:docs'
  - 'area:voice'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Mistral slot quota empirical verification

**Why:** PR 2 ships defensive eviction code modeled on ElevenLabs' "musical chairs" pattern, but Mistral's account-level voice quota is undocumented. Smoke test (4 clones) was insufficient to probe limits. Eviction code may never fire. **Fix shape**: post-deploy, attempt many clones in single account; observe error shape + threshold; document in `docs/research/voice-cloning-2026.md`. **Promote when**: PR 2 has been in production for 2+ weeks without eviction firing AND we want to know whether to keep or remove the dead-on-arrival code. Surfaced 2026-05-02. Deferred 2026-05-07.

Owner question: Should we spend an account's worth of clone attempts now to probe Mistral's undocumented voice quota, or keep this filed?
Recommendation: Keep filed — the task's promote-when has two halves (PR 2 in production 2+ weeks without eviction firing AND wanting to decide whether to keep or remove the code), and neither has been stated as met, so the probe would answer a question nobody is currently asking.

Decision 2026-09-02 (owner): keep filed until the promote-when fires (PR 2 in prod 2+ weeks without eviction AND a keep-or-remove decision pending).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Explicit owner decision recorded in the task itself (2026-09-02): "keep filed until the promote-when fires." Both promote-when halves (PR 2 in prod 2+ weeks without eviction firing AND a keep-or-remove decision pending) are unmet per the recorded recommendation. Evidence: `cat` of full task file — decision note dated 2026-09-02 present below the description.
---
author: backlog-pilot
created: 2026-11-26 23:41
---
CLOSED OBSOLETE (backlog pilot, 50-oldest sweep). The subject the task watched no longer exists: the defensive Mistral eviction code this probe was to adjudicate was NEVER SHIPPED. Current evidence on develop: `services/ai-worker/src/services/voice/providers/MistralTtsProvider.ts:20-22` — "Mistral slot quota behavior is undocumented (smoke test didn't probe). If a future MistralApiError surfaces a slot-limit error, eviction code is straightforward to add (mirror ElevenLabsVoiceService.evictAndClone)." Grep `evictAndClone` across `*.ts`: hits only in ElevenLabsVoiceService.ts (:98,:124,:146,:151) and that Mistral comment — MistralTtsProvider has the eviction mutex (line 118) but no victim-selection/eviction. The design pivoted to add-on-demand, so the promote-when ("2+ weeks in prod WITHOUT eviction firing AND a keep-or-remove decision pending") can never fire as written: there is no eviction code to observe not firing, and the keep-or-remove question answered itself. The 2026-09-02 owner decision ("keep filed until promote-when") was premised on the eviction code existing; that premise is false, verified by grep. Archived with reason in the removing commit; `pnpm tracker task restore 91` reverses.
---
<!-- COMMENTS:END -->
