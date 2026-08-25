---
id: TASK-766
title: >-
  MUTE-mode denials leak on the slash path - runSlashChatGates replies with the
  explicit denial message
status: Done
assignee: []
created_date: '2026-08-24 16:17'
updated_date: '2026-08-25 16:02'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 766000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2212 round-2 review (verified against slashChatGates.ts and its test) - runSlashChatGates checks isPersonalityDenied with no mode check and unconditionally editReplies DENYLIST_BLOCK_MESSAGE ("You do not have access to this character..."), so a MUTE-denied user probing /chat, /random, or /chime-in gets a crisp ephemeral confirmation of the denial MUTE exists to hide. PR 2212 fixed the message-pipeline leak (the live-observed public notice); the owner chose ship-and-file for this residual. Existing test "blocks and replies when the personality is denied to the actor" pins the mode-blind behavior and must be split by mode.

Fix shape: thread the mode the way PR 2212 did - consult isPersonalityMuted in runSlashChatGates; BLOCK keeps DENYLIST_BLOCK_MESSAGE. Design decision for the MUTE arm (slash interactions MUST be acked, so literal silence is not available): reply with a generic could-not-complete message indistinguishable from a transient failure, so the probe learns nothing definitive. Pick the exact wording from the ux catalog generic-failure entries rather than inventing new copy; seam-test both modes.

Acceptance: a MUTE-denied user running /chat character:X receives a generic failure reply that names no denial and no access state; a BLOCK-denied user still receives DENYLIST_BLOCK_MESSAGE; both pinned by tests.
<!-- SECTION:DESCRIPTION:END -->
