---
id: TASK-770
title: >-
  NSFW-verification block posts the generic unavailable message, and prompt
  cleanup leaves it as the only visible explanation
status: To Do
assignee: []
created_date: '2026-08-25 10:42'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 770000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prod-observed 2026-08-25 ~06:47Z. A user blocked by the NSFW gate (reason not-verified) received BOTH the specific verification prompt AND the generic multi-tag denial ("None of the tagged characters are currently available. They may be private, on the denylist, or restricted in this channel"). After auto-verification succeeded, cleanupVerificationMessagesForUser deleted the 4 prompts — leaving only the generic denials in channel history, which name private/denylist/restricted but never age verification. The user read it as a moderation block ("IM OVER 18 GODDAMMIT"); the owner then had to investigate. Runtime evidence: bot-client logs 06:46:43-06:48:28Z, userId 174272240915841024, 4x "Interaction blocked - user not NSFW verified" each paired with an "All multi-tag slots failed" generic response.
Fix shape: in the multi-tag denial fan-in (multiTagDeliveryFlow / slot denial rendering), when the denial reason is nsfw-not-verified, suppress the generic unavailable message entirely (the verification prompt already explains the block) OR add verification to the generic message reasons. Prefer suppression - one clear message per user action. Consider whether cleanup should also apply to the paired generic denials it orphans.
Acceptance: an unverified user mentioning a character gets exactly one response naming age verification; post-verification history does not read as a moderation denial. Sibling flows swept (DM path, slash path via slashChatGates.ts share the gate - verify their rendering separately).
<!-- SECTION:DESCRIPTION:END -->
