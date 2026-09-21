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

MEASURED 2026-09-21 (prod, read-only, emily-tzudad-seraph-ditza, 2708 memories grouped by channel; script docs/local/handoffs/voice-drift-by-channel.ts, the per-channel sibling of voice-drift-curve.ts; aggregates only, first half vs second half of each channel in time order; excl = exclamation marks per 1k assistant chars, chars = mean assistant reply length):
- CANDIDATE, channel 1551206427014602762 (the owner's current diary thread, 2026-09-20 to 09-21, 65 memories in two days, AFTER the cross-channel user-only render was on Emily): excl 0.90 -> 0.44, chars 694 -> 1027, the pet-name rate 0.14 -> 0.44 per 1k. Same-channel drift within one thread, with the cross-channel vector already removed - the discriminating observation Phase 4 wanted. Use this channel for the with/without read.
- Same shape pre-fix, channel 1546862190173094089 (2026-09-08 to 09-09, 61 memories): excl 0.12 -> 0.07, chars 1389 -> 1860, courtroom vocabulary present throughout.
- Long-lived channel 1226207363342663781 (2024-12 to 2026-09, 141 memories): excl 4.14 -> 1.52 and courtroom vocabulary 0 -> present, but the span is 21 months so time confounds it; not the slice candidate.
- Reference points on doc-97: fresh-thread OFF arm 4.1 excl/1k and 241 chars; the winter card register 1.3 to 3.8.
So the measured default for N (verbatim recent turns) should be read off the diary thread: the register halves by roughly the 30-exchange mark of a single day. Build behind the override and re-run this script on the same channel id after a day with the mode on.
<!-- SECTION:DESCRIPTION:END -->
