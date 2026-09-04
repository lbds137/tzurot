---
id: TASK-624
title: >-
  Check whether models echo the location tag; add it to
  PROMPT_TEMPLATE_ORPHAN_TAGS if so
status: To Do
assignee: []
created_date: '2026-08-15 22:56'
updated_date: '2026-09-04 19:37'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. the sweep (prod diagnostic logs for literal `<location>` echoes) has not been performed and the archive/add decision hasn't been made; `location` is still absent from the vocabulary while `participants` (adjacent in the S1 prefix) is present. Evidence: `sed -n '150,161p' services/ai-worker/src/utils/responseArtifacts.ts` → `PROMPT_TEMPLATE_ORPHAN_TAGS` still lists `chat_log, participants, protocol, memory_archive, contextual_references, facts` — no `location`.
---
<!-- COMMENTS:END -->
