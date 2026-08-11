---
id: TASK-536
title: Is the same-personaId dedup path still reachable
status: To Do
assignee: []
created_date: '2026-08-11 21:58'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 536000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: reviewer observation on PR 2067, offered honestly as unverified rather than asserted. While tracing callers it found that the only production producer of context.participants - extractParticipants in ContextStep.ts, which keys a Map by personaId so same-id entries already collapse during history extraction - composed with mergeParticipants, which filters mentionedPersonas by existingIds.has(personaId), appears to already guarantee unique personaIds by the time getAllParticipantPersonas runs.

If that holds, the SAME-user-two-display-names half of the dedup logic in shouldSkipDuplicateParticipant describes a scenario that no longer occurs upstream - three tie-break branches, their tests, and a docblock all maintained for a dead path. Note this is entirely separate from the bug 2067 fixed, which was two DIFFERENT users colliding on one name; that fix stands either way.

The reviewer explicitly did not runtime-verify it and neither has anyone else, so this is a question, not a finding. Code-reading suggests unreachable; that is a hypothesis until something observes it.

What: add a counter or a one-line debug when getAllParticipantPersonas sees a second sighting of an already-mapped personaId, let it run in prod for a normal window, and then decide. If it never fires, the dedup branches can be collapsed to a plain overwrite and the tests reduced to the collision case. If it does fire, close this with the evidence and keep the logic.

Do NOT delete the dedup logic on the strength of the code read alone - a removal KEEP-list is a set of claims too, and this one has no runtime observation behind it.

Acceptance: a runtime answer either way, and the dedup logic either simplified with that evidence cited or explicitly kept.
<!-- SECTION:DESCRIPTION:END -->
