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
FIX-SHAPE CORRECTION 2026-08-20, before any build. The paragraph above says to gate normalization on the origin resolving to one of our characters, naming authorPersonalityId as the signal. That signal is WRONG for this job, for the same reason TASK-668's prescribed gate was wrong: authorPersonalityId comes from replyResolver.resolveFromReferencedMessage, which resolves identity AND applies an access check (loadPersonality(id, viewerId) returns null on denial, ReplyResolutionService.ts:229-234). So a forward of our own character message, viewed by someone who cannot load that personality, yields undefined and the footer would be LEFT IN — under-stripping in exactly the case the leak matters.

The question this task needs answered is authorship (did WE write this message), not visibility (may this viewer see the character). Those are different questions and only one of them is about our own markup being in the text. Our own markup is ours to strip regardless of who is looking.

The authorship signal is already in scope where the origin is resolved and needs no access check: the fetched original carries webhookId (a webhook message, disambiguated as ours by the bot-suffix check that resolveWebhookAwareDisplayName already performs via extractPersonalityName) or, for a DM personality response, an author id equal to our own client user id. Both are cheap and viewer-independent. Whatever this task builds should derive from those, not from authorPersonalityId.

Note this makes the ordering dependency on TASK-706 weaker than recorded above: what 706 supplies is the fetched original at conversion time, not the personality resolution. Still sequence after 706 to avoid editing the same functions concurrently, but the reason is conflict avoidance, not a data dependency.
<!-- SECTION:DESCRIPTION:END -->
