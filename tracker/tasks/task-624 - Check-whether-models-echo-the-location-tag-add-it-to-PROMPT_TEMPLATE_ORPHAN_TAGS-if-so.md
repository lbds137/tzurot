---
id: TASK-624
title: >-
  Check whether models echo the location tag; add it to
  PROMPT_TEMPLATE_ORPHAN_TAGS if so
status: To Do
assignee: []
created_date: '2026-08-15 22:56'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 624000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: responseArtifacts.ts strips hallucinated prompt-structure tags from model output via PROMPT_TEMPLATE_ORPHAN_TAGS; <participants> is in that vocabulary but <location> is not. Pre-existing (location was never listed), but since PR 2108 the location block sits directly beside participants in the S1 prefix ahead of chat_log, so the latent echo risk is now adjacent to an explicitly guarded block (round-5 review observation).

What: sweep recent prod diagnostic logs / responses for literal <location echoes. If any exist, add the tag to the vocabulary with a pinned test; if none, archive as checked-and-clear with the sweep command in the removing commit.

Acceptance: either the tag is in PROMPT_TEMPLATE_ORPHAN_TAGS with a test, or the archive commit names the negative sweep evidence.
<!-- SECTION:DESCRIPTION:END -->
