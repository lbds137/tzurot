---
id: TASK-1039
title: >-
  doc-97 Phase 4 first slice: apply the user-only history treatment to
  same-channel history beyond the recent turns
status: To Do
assignee: []
created_date: '2026-09-21 19:49'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: high
ordinal: 1033000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-21 - with the cross-channel user-only render on Emily in prod, voice drift is mostly resolved across channels but still sets in when a single channel holds many messages. Same-channel history is verbatim up to the cap (services/ai-worker/src/services/context/channelHistoryHydration.ts ~53-56, MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES 50 and MAX_EXTENDED_CONTEXT 100 in packages/common-types/src/constants/message.ts), so every one of the character own turns in the current channel still reaches the generation point, which is the drift vector doc-97 Phase 4 names (design pass done 2026-09-16, opened by the fresh-thread probe; this report is the discriminating observation it was waiting for). The voice anchor (services/ai-worker/src/services/prompt/VoiceAnchorFormatter.ts) is one block against dozens of her own turns in a long channel.
Fix shape: a same-channel render mode, same vocabulary as crossChannelRenderMode: keep the last N turns verbatim (N a config override with a measured default) and render older assistant turns either omitted or as the archive split-render already does for the memory archive (user turn verbatim, assistant prose replaced by linked facts or a summary). Measure first: take one long Emily channel the owner names, compute the exclamation-per-1k and reply-length curve the theme already uses over that channel, then build behind a config override so the same channel can be read with and without it. Depends on the doc-97 Phase 4 pre-pass gate (coverage of assistant turns with current summaries, measured on prod).
Acceptance: the same long channel rendered with the mode on shows the card register measures moving toward the fresh-thread baseline recorded on doc-97, with no loss of user-side continuity; the override cascades like the cross-channel knobs; the prompt payload for a turn shows the reduced assistant-side history.
<!-- SECTION:DESCRIPTION:END -->
