---
id: TASK-708
title: Forwarded content of our own messages keeps the -# model footer in the prompt
status: To Do
assignee: []
created_date: '2026-08-20 22:28'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 708000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner dev smoke 2026-08-20, debug payload request 38a58442-83c5-405d-8a6b-d1665884b2ce. A forward of one of OUR character replies rendered inside <quote type="forward"> with our own subtext footer intact: "-# Model: [glm-5.2](<https://docs.z.ai/guides/llm/glm-5.2>) - via Z.AI Coding Plan". Runtime-observed in the assembled prompt, not code-read. Two separate quotes in the one payload carried it. The whole point of normalizeMessageForContext is that the model never sees these markers and roleplays around them.

Mechanism: DiscordChannelFetcher.convertMessage line 459 applies normalizeMessageForContext only when isOurMessage. For a forward the WRAPPER author is the human forwarder, so isOurMessage is false, while rawContent is extractForwardedContent output, which is the SNAPSHOT of our character message including the footer. Same gap on the other producers: ConversationPersistence persists forward content unnormalized, and MessageFormatter.ts:43 builds reference-path quote content from a bare extractForwardedContent. Three producers, one class.

Do NOT fix by normalizing forwarded content unconditionally. The module docstring on normalizeMessageForContext claims both sub-functions are pattern-specific and never mangle legitimate user content even if mis-applied. That claim is FALSE for the prefix half: DM_PREFIX_PATTERN is /^\*\*[^*]+:\*\*\s*/ (discord.ts:484), which strips ANY bold Name: prefix, so a forwarded human message opening with a bold label loses it. Correcting or scoping that docstring is part of this task.

Fix shape: gate normalization of forwarded content on the origin resolving to one of our own characters. TASK-706 puts exactly that signal (authorPersonalityId from resolveForwardedOrigin) into the fetcher, so this lands cleanly after it. Sweep all three producers or file the unswept ones.

Acceptance: a forward of one of our character replies renders with no -# footer in the extended-context path, the persisted path, and the reference-quote path; a forward of a human message whose text opens with a bold Name: prefix keeps it, pinned by a test; the false docstring claim is corrected.
<!-- SECTION:DESCRIPTION:END -->
