---
id: TASK-622
title: >-
  Roster active-flag and collision note make the system-prefix per-speaker
  volatile
status: To Do
assignee: []
created_date: '2026-08-15 21:58'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 622000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the minimal-user-turn PR moved <participants> into the S1 system prefix for cacheability, but the block still carries two per-request bits: active="true" on the current speaker and the name-collision note (both derived from context.activePersonaName/discordUsername). In multi-human channels every speaker change re-renders the block and invalidates the prefix from participants onward. Measured signature: same-length hash changes at offset ~172-209 in channel 1481138179917615144.

Fix shape: (a) drop active="true" from the roster - the <from id pronouns> tag on the current turn now identifies the speaker, so the flag is redundant; (b) make the collision note speaker-independent (render for any roster member whose name collides with the personality, not just the active one) or move it to the human message. Both change what the model sees, so the owner picks.

Acceptance: participants block bytes are invariant across consecutive turns with different speakers in the same channel (extend the ParticipantFormatter byte-identity test), and prod prefix-diff shows no same-length participants churn.
<!-- SECTION:DESCRIPTION:END -->

RIDER (from PR 2108 round-5 review, routed here because this task reworks the
roster rendering and its tests): add a PromptBuilder.test.ts assertion that the
system message ends with </participants> when the roster is non-empty and there
is no history — today only the empty-roster tail case is pinned directly.
