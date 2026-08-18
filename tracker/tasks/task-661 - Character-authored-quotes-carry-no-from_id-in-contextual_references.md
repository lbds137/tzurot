---
id: TASK-661
title: Character-authored quotes carry no from_id in contextual_references
status: To Do
assignee: []
created_date: '2026-08-18 19:46'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 661000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by review on PR #2143 (TASK-657 slice A), which closed this same defect class for the chat_log path. The reference path still has it.

The gap, verified: ReferencedMessageFormatter.fromLiveReference sets fromId: persona?.personaId and nothing else (services/ai-worker/src/services/ReferencedMessageFormatter.ts:410), while deriveRefRole can classify a quoted message as role="character" (services/ai-worker/src/services/prompt/referenceRole.ts:152 and :175). So a quote authored by a SIBLING AI character renders inside contextual_references with role="character" and no from_id -- the same unresolvable binding slice A fixed for chat_log lines.

Now fixable in a way it was not before: PR #2143 added character_participant entries to the participants roster, so a personality UUID finally has something to resolve against. Before that there was no roster entry to point at, which is why only the persona id was ever emitted.

Scope note: this is NOT part of TASK-660. That task is the generated blurb and card checksum; folding an unrelated binding fix into it would blur its acceptance. Deliberately filed separately.

Fix shape: give the live reference path the same two-id-space treatment formatFromIdAttribute got in conversationUtils.ts -- persona id for a user-authored quote, personality id for a character-authored one, nothing for the responder own lines. Check the STORED reference path for the same gap before closing; slice A only touched the chat_log renderer.

Acceptance: a character-authored quote in contextual_references carries a from_id that resolves to a character_participant entry; a test pins the user-authored and self-authored cases unchanged.
<!-- SECTION:DESCRIPTION:END -->
