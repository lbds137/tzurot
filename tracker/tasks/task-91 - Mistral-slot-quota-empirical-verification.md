---
id: TASK-91
title: Mistral slot quota empirical verification
status: To Do
assignee: []
created_date: '2026-05-02 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:docs'
  - 'area:voice'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Mistral slot quota empirical verification

**Why:** PR 2 ships defensive eviction code modeled on ElevenLabs' "musical chairs" pattern, but Mistral's account-level voice quota is undocumented. Smoke test (4 clones) was insufficient to probe limits. Eviction code may never fire. **Fix shape**: post-deploy, attempt many clones in single account; observe error shape + threshold; document in `docs/research/voice-cloning-2026.md`. **Promote when**: PR 2 has been in production for 2+ weeks without eviction firing AND we want to know whether to keep or remove the dead-on-arrival code. Surfaced 2026-05-02. Deferred 2026-05-07.
<!-- SECTION:DESCRIPTION:END -->
