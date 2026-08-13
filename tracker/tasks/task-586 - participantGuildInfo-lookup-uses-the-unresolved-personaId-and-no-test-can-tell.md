---
id: TASK-586
title: participantGuildInfo lookup uses the unresolved personaId and no test can tell
status: To Do
assignee: []
created_date: '2026-08-13 12:13'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 586000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: MemoryRetriever.getAllParticipantPersonas looks up guild info as context.participantGuildInfo[participant.personaId] - the UNRESOLVED id - while the docstring a few lines above claims those keys are UUIDs remapped by ExtendedContextPersonaResolver alongside the persona resolution pass. If that remap does not make the two identical for every participant shape, the lookup silently returns undefined and the participant renders with no guild info: no error, no log, just a missing roles/color block in the prompt.

Why no test catches it: every existing test mocks resolveToUuid as an identity function (input persona-lila resolves to persona-lila), so pre-resolution and resolved are the same string and the fixture cannot distinguish which one the lookup uses. The TASK-560 guildInfo test says so in its own comment rather than pretending otherwise.

What to do: trace the PRODUCER, not the docstring - find where bot-client builds participantGuildInfo and confirm which id space its keys live in (ExtendedContextPersonaResolver.resolveExtendedContextPersonaIds is the named remap). Then either fix the lookup to use resolvedPersonaId, or keep it and pin the equivalence. Either way add a test where resolveToUuid returns something DIFFERENT from the input, so the two id spaces are actually distinguishable.

Acceptance: a test in which the unresolved and resolved ids differ pins which one participantGuildInfo is keyed by, and the docstring matches the traced producer. Source: PR 2086 review round 4, Nit - flagged as a real latent gap, non-blocking.
<!-- SECTION:DESCRIPTION:END -->
