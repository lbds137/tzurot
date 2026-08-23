---
id: TASK-745
title: >-
  Flag-on real messages: current-channel signal loses to nine wrong-channel
  location blocks and present-tense memory location claims
status: To Do
assignee: []
created_date: '2026-08-23 13:30'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 745000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner prod report 2026-08-23 (requestId 98aa4319, channel technology/500353302840606730, Lila Elyona, glm-5.3) - with realMessagesEnabled ON the model anchored to the wrong channel ("The clown channel was the right venue"), which did not happen flag-off. Payload-verified mechanism, three converging factors:

1. The ONE correct location (<channel name="technology"> in the system S1 location section, offset ~24.5k of msg[0]) no longer structurally wraps the history it describes - flag-off the chat_log rendered in the SAME system message right after <location>; flag-on the system sections end at participants and 84 history messages + a 270k current-turn envelope sit between the location and the generation point.

2. NINE identical-markup <location type="guild"> blocks for OTHER channels (incl. clown-circus - the exact channel the reply named) open message [1] (<prior_conversations>, 166k chars) with NO instruction header distinguishing them from the current channel - same tag shape, 9-to-1 wrong-to-right, and closer to the generation point.

3. THREE present-tense location claims baked into memory-archive text in the final message ("This conversation is taking place in ... Channel: #diaries-2025 Thread: 2025-12-30" - the old reference-formatter markup stored inside memory content), at offsets ~218k-261k of msg[85] - the closest location-shaped text to the generation point, asserting a false CURRENT location.

Fix shape (candidates, pick at build): (a) echo a distinctively-named <current_location> one-liner beside <datetime> in the V-tier current-turn envelope - right signal closest to generation, ~1 line volatile cost; (b) give <prior_conversations> an instruction header naming these as OTHER channels (or rename its location tags, e.g. scope="other_channel") so the markup stops competing; (c) render-time transform on stored "This conversation is taking place" strings to past tense - the claims are baked into memory content by the OLD formatter, so only a render-time fix reaches existing rows. (a)+(b) are prompt-assembly changes in ai-worker PromptBuilder/RealMessages path; (c) touches the memory render in the same area. Adjacent: TASK-671 (stale facts recirculate) shares the stored-text-asserts-stale-present-state class with (c).

Acceptance: flag-on payload for a guild channel shows a distinctive current-channel marker in the current-turn envelope; prior_conversations locations are explicitly scoped as other channels; a stored "taking place" string renders past-tense; pinned by RealMessages-mode render tests.
<!-- SECTION:DESCRIPTION:END -->
