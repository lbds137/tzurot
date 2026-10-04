---
id: TASK-1158
title: >-
  Channel system events (pin, thread rename) never reach the model: log them
  into extended context with metadata, without triggering a character
status: To Do
assignee: []
created_date: '2026-10-04 16:45'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1150000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-10-04 (own words): "do Tzurot characters know about Discord events like messages being pinned or threads being renamed? those events should not trigger an activated character but they should be logged as part of extended context with appropriate metadata (old name and new name, what the pinned message actually was, etc.)". Answer from the code (read, not runtime-verified): NO. isUserContentMessage (services/bot-client/src/utils/messageTypeUtils.ts) admits only Default, Reply, ChatInputCommand, ContextMenuCommand and forwards, and explicitly rejects ChannelPinnedMessage (6), ThreadCreated (18), ThreadStarterMessage (21), UserJoin and the rest. Both consumers use it: MessageHandler.handleMessage (logs "Ignoring system message" at debug, so the TRIGGER path correctly never wakes a character) AND the extended-context fetcher (services/bot-client/src/services/channelFetcher/messageTypeFilters.ts, DiscordChannelFetcher), so the events are also dropped from context. Related: doc-54 (diegetic Discord events) covers deletion tombstones and reaction stimuli but NOT channel system messages; extend it rather than fragmenting.
What: keep the trigger-path rejection as is. In the context fetch only, admit the pin and thread-rename system types and render each as a system-event line with metadata (actor, kind, old and new name for a rename, the pinned message id plus an excerpt or reference for a pin). Needs, UNVERIFIED and to be probed before design: whether a thread or channel rename produces a channel MESSAGE at all. From memory (not checked against discord.js 14.27 typings or a live capture): MessageType.ChannelNameChange (4) is the group-DM rename notice, and a guild thread or channel rename may arrive only as a gateway threadUpdate / channelUpdate event (old and new objects both present, so the old name is free) with no message, in which case the rename cannot ride the message fetch and needs an event listener plus a stored line (no bot-client listener for threadUpdate or channelPinsUpdate exists today: grep of services/bot-client/src found none). Same probe for pins: a pin posts a ChannelPinnedMessage (6) system message whose reference points at the pinned message. The pinned message target is msg.reference.messageId and is msg.reference.messageId and must go through the same viewer-access gate as other references. Render shape belongs with the prompt-assembly sections (no new tag without guard:prompt-tags).
Acceptance: a pin and a rename in a channel appear in the next character turn context as non-trigger system events with their metadata; neither wakes a character; a test pins the trigger path still ignoring them.
<!-- SECTION:DESCRIPTION:END -->
