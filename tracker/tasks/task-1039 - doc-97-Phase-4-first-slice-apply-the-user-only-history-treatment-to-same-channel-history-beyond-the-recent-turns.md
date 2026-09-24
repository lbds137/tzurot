---
id: TASK-1039
title: >-
  doc-97 Phase 4 first slice: apply the user-only history treatment to
  same-channel history beyond the recent turns
status: To Do
assignee: []
created_date: '2026-09-21 19:49'
updated_date: '2026-09-24 12:50'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: high
ordinal: 1033000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-21 - with the cross-channel user-only render on Emily in prod, voice drift is mostly resolved across channels but still sets in when a single channel holds many messages. Same-channel history is verbatim up to the cap (services/ai-worker/src/services/context/channelHistoryHydration.ts ~53-56, MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES 50 and MAX_EXTENDED_CONTEXT 100 in packages/common-types/src/constants/message.ts), so every one of the character own turns in the current channel still reaches the generation point, which is the drift vector doc-97 Phase 4 names (design pass done 2026-09-16, opened by the fresh-thread probe; this report is the discriminating observation it was waiting for). The voice anchor (services/ai-worker/src/services/prompt/VoiceAnchorFormatter.ts) is one block against dozens of her own turns in a long channel.
Fix shape: a same-channel render mode, same vocabulary as crossChannelRenderMode: keep the last N turns verbatim (N a config override with a measured default) and render older assistant turns either omitted or as the archive split-render already does for the memory archive (user turn verbatim, assistant prose replaced by linked facts or a summary). Measure first: take one long Emily channel the owner names, compute the exclamation-per-1k and reply-length curve the theme already uses over that channel, then build behind a config override so the same channel can be read with and without it. Depends on the doc-97 Phase 4 pre-pass gate (coverage of assistant turns with current summaries, measured on prod).

GATE MEASURED 2026-09-21 (prod, read-only, after the beta.228 cut; script docs/local/handoffs/doc97p4-coverage.ts, run from scripts/analysis/; aggregates only): the same-channel window of the diary thread (channel 1551206427014602762, cap 100 rows = 50 user + 50 assistant, 2026-09-20 14:20Z to 09-21 03:54Z) - all 50 assistant turns map to exactly one memory through the preceding user row (matched 50, off-channel 0, exchanges with several user rows 0, and the channel-scoped memory count since the window start is also 50), so the join premise the theme doc left unverified HOLDS on this channel: an assistant turn resolves to its memory through the user message id before it, no producer change needed for the read. Coverage: 46 of 50 assistant turns carry a usable summary (summary_status done, non-empty assistant_summary, not a chunk - the memoryUtils.ts render predicate) = 0.92; the other 4 are summary_status failed (retryable), none pending, none dead. So the split-render of older same-channel assistant turns has summaries for 92 percent of them on the channel that shows the drift, and a verbatim fallback covers the rest. Relabelled state:ready (was state:dependent on this read); size stays M.
Predicate note for the build: the render-time predicate ignores summary_prompt_version (a stored done summary renders regardless; memoryUtils.ts), while the flip gate in tooling counts done_current only - use the render predicate here, since this mode renders what is stored.
Acceptance: the same long channel rendered with the mode on shows the card register measures moving toward the fresh-thread baseline recorded on doc-97, with no loss of user-side continuity; the override cascades like the cross-channel knobs; the prompt payload for a turn shows the reduced assistant-side history.

MEASURED 2026-09-21 (prod, read-only, emily-tzudad-seraph-ditza, 2708 memories grouped by channel; script docs/local/handoffs/voice-drift-by-channel.ts, the per-channel sibling of voice-drift-curve.ts; aggregates only, first half vs second half of each channel in time order; excl = exclamation marks per 1k assistant chars, chars = mean assistant reply length):
- CANDIDATE, channel 1551206427014602762 (the owner's current diary thread, 2026-09-20 to 09-21, 65 memories in two days, AFTER the cross-channel user-only render was on Emily): excl 0.90 -> 0.44, chars 694 -> 1027, the pet-name rate 0.14 -> 0.44 per 1k. Same-channel drift within one thread, with the cross-channel vector already removed - the discriminating observation Phase 4 wanted. Use this channel for the with/without read.
- Same shape pre-fix, channel 1546862190173094089 (2026-09-08 to 09-09, 61 memories): excl 0.12 -> 0.07, chars 1389 -> 1860, courtroom vocabulary present throughout.
- Long-lived channel 1226207363342663781 (2024-12 to 2026-09, 141 memories): excl 4.14 -> 1.52 and courtroom vocabulary 0 -> present, but the span is 21 months so time confounds it; not the slice candidate.
- Reference points on doc-97: fresh-thread OFF arm 4.1 excl/1k and 241 chars; the winter card register 1.3 to 3.8.
So the measured default for N (verbatim recent turns) should be read off the diary thread: the register halves by roughly the 30-exchange mark of a single day. Build behind the override and re-run this script on the same channel id after a day with the mode on.

SLICE 1 SHIPPED 2026-09-22 in #2471 (develop ee7de373b, six review rounds): sameChannelRenderMode (both | summarized | user-only, default both) and sameChannelVerbatimExchanges (1-50, default 10) on every settings dashboard's Memory page; older responder turns replaced by their stored summary through the trigger user message, verbatim where none is usable; the window counts COMPLETED exchanges only (a trailing unanswered user run never counts against N); rendered="summary" on substituted XML turns and one info line per non-both turn. The task stays OPEN for the acceptance's register clause: enable summarized on Emily via the dashboard once dev has the build, run voice-drift-by-channel.ts on 1551206427014602762 after a day with the mode on, compare against the 09-21 numbers above. That read is the beta.229 cut criterion and tunes the default N.

READ PLAN (owner, 2026-09-22): 09-22 in the diary thread is the mode-OFF day; the owner flips summarized on and chats 09-23, noting the flip time. Compare the within-day curves (OFF day vs ON day), split at the flip time, not the halves. Open product question for slice 2, raised by the owner: does user-only stay a user-facing choice once summarized is proven? Cost does not argue for it (summaries are already produced by the memory pipeline, so summarized adds no model call at render). It stays for now as the fallback arm if the summaries themselves carry the drifted register; decide at slice 2 whether to drop it from the dashboard.
FLIP (owner, 2026-09-23, recorded ~08:50 EDT / 12:50Z; exact flip time before that, same morning): summarized turned on in dev for Emily; the owner also "added lilith-tzel-shani to the roster" (owner words; read as summarized on for her too - confirm at read time whether she also speaks in the diary thread, since a second responder in the channel changes the history shape the curve measures). The first 09-23 message in the diary thread went to PROD before the owner synced and switched to dev, so the dev read starts at the second message (one-message gap, negligible). Lilith OFF baseline: the owner chatted with her a little on 09-22 (owner, 2026-09-23), so her OFF day is 09-22 too, with a smaller sample than Emily; find which channel(s) at read time and report her sample size beside her curve.
READ 2026-09-24: inconclusive, the mode barely engaged (details in the 2026-09-24 comment).
OWNER RULING 2026-09-24 (AskUserQuestion, "Yes, N=3"): the owner sets sameChannelVerbatimExchanges to 3 on Emily and Lilith (Memory settings page) for one more read day. The second read runs once that day's thread is complete:
- Find the day's thread(s) with docs/local/handoffs/voice-drift-probe-1039.ts, then run voice-drift-read-1039.ts on them, split at the time N changed. Compare against the 09-22 OFF thread 1551910122136281108.
- Confirm engagement from the ai-worker "Same-channel history rendered" lines (summarized greater than 0) in the env the owner chatted in. The diagnostic rows and logs are env-local, while the memories sync.
- Then the read decides slice 2 and whether N returns to 10.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-23 23:58
---
READ WINDOW CLOSED (owner, 2026-09-23 ~23:55 EDT): the diary thread (channel 1551206427014602762) is winding down. The owner keeps using it until sleep tonight and starts a FRESH thread on 09-24. So the ON-day data is this channel from the flip (~08:50 EDT 09-23) to the owner's last message tonight; the OFF day is 09-22 in the same channel.
- Exclude the 09-24 fresh thread from this read. It is a different channel with a short history, the opposite of the long-thread drift being measured.
- It can serve later as a first-day ON reference, if slice 2 wants one.
- Owner ruling 2026-09-23: the beta.229 cut no longer waits for this read (backlog/now.md Cut when). Run it once the ON day is complete (09-24 onward); it decides slice 2.
---

created: 2026-09-24 12:46
---
READ RUN 2026-09-24 (dev + prod, read-only, aggregates only; scripts docs/local/handoffs/voice-drift-read-1039.ts and three sibling probes). Result: inconclusive for the mode, because the mode barely engaged.
- Premise correction: the owner started a new thread each day. Channel 1551206427014602762 has NO memories since 09-22. The OFF day is thread 1551910122136281108 (09-22, Emily 14 + Lilith 7, all prod per diagnostic rows); the ON day is thread 1552294416188833822 (09-23 to 09-24 01:37 EDT, Emily 11 = 1 prod + 10 dev, Lilith 16 dev). Prod and dev hold identical memory sets for both threads.
- Engagement: the verbatim window counts the RESPONDER's own completed exchanges (segmentExchanges in sameChannelRender.ts). With N 10, Emily never had more than 10 prior turns in the ON thread, so 0 of her ON prompts summarized anything (dev log: verbatimExchanges 9 and 10, summarized 0 on her last two). Lilith reached 16, so her turns 12-16 summarized 1-5 (dev log confirms 4 and 5 on turns 15 and 16). On her turn-15 prompt the 4 oldest turns are present as their stored summaries and turns 5-14 verbatim (prefix match on the diagnostic assembledPrompt, booleans only): the substitution reaches the prompt.
- Numbers (avg assistant chars, excl per 1k): Emily OFF 14 turns 874 / 0.25; Emily ON-in-name 10 turns 998 / 0.60 (zero substitutions, so this is day-to-day variance, not the mode). Lilith OFF 7 turns 1337 / 0; Lilith ON turns 1-10 1370 / 0; turns 11-16 1144 / 0 (6 turns, noise-level).
- New observation: both fresh threads open in the long low-exclamation register from turn 1 (Emily 09-22 turns 1-10: 812 chars, 0.37 excl/1k, vs the doc-97 fresh-thread baseline 241 chars / 4.1). An empty same-channel history cannot produce that, so under one-thread-per-day usage same-channel history is not what sets the register. Candidates, untested: the owner's diary-entry length (reply length tracks input), retrieved memories, the card.
- Side: summarized turn 3's verbatim prefix also appears in that prompt (both its summary and its verbatim matched), possibly via memory retrieval; unverified. The missing rendered marker is filed as TASK-1077.
- Slice 2 is not decided by this read. Next step is the owner question in the description.
---
<!-- COMMENTS:END -->
