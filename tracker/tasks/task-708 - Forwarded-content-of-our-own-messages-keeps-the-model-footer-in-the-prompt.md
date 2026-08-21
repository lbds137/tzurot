---
id: TASK-708
title: Forwarded content of our own messages keeps the -# model footer in the prompt
status: To Do
assignee: []
created_date: '2026-08-20 22:28'
updated_date: '2026-08-21 00:49'
labels:
  - 'area:bot-client'
  - 'size:L'
  - 'state:ready'
dependencies: []
priority: high
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

CLASS ENUMERATION 2026-08-20 (grep + forward trace, each verdict cited). The task text above names three producers. The real class is SIX prompt-bound sites, and one of them is the current turn rather than history — which changes the severity, not just the size.

MEMBERS — forwarded snapshot text reaches the model with our markup intact:
1. handlers/references/MessageFormatter.ts:43 — reference/quote path. Named above. Reaches rawReferencedMessages via ReferenceFormatter:156 -> MessageReferenceExtractor:177 -> MessageContextBuilder:365-371. No normalization anywhere on the path.
2. services/DiscordChannelFetcher.ts:446 (content via MessageContentBuilder:233), gated at :473 on isOurMessage. This is the originally-reported case: for a forward the WRAPPER author is the human forwarder, so the gate is false and the snapshot passes through raw.
3. utils/HistoryLinkResolver.ts:347 (content via MessageContentBuilder:233) — NOT named above. Builds StoredReferencedMessage, persisted into messageMetadata, later rendered. No normalization.
4. contextBuilder/RawEnvelopeBuilder.ts:165 — NOT named above, and the most consequential. rawMessageContent IS THE CURRENT TURN. Verified by reading the line: withStickerAndPollDescriptions(message, getEffectiveContent(message)). So forwarding one of our character replies and triggering a character in that same message puts our own footer into the live turn, not only into later history.
5. processors/PersonalityTriggerProcessor.ts:132 — getEffectiveContent feeds coordinator.startFanOut, into context building.
6. processors/DMSessionProcessor.ts:156 — same shape on the DM path.
   (Also PersonalityTriggerProcessor.ts:286, a third getEffectiveContent call the first trace pass missed — confirm its consumer before deciding whether it is a seventh member.)

NON-MEMBERS, with reasons:
- handlers/references/strategies/LinkReferenceStrategy.ts:30 — parses message LINKS out of the text. The text itself never reaches the prompt; only discovered link targets do, and those are fetched separately. Footer text cannot survive a link regex.
- utils/forwardedMessageUtils.ts:279 (extractAllForwardedContent) — its content field is never read. Its only caller, hasForwardedVoiceAttachment:306, destructures attachments alone. See the dead-field note below.

THE CONSTRAINT THAT SHAPES THE FIX, from a comment at RawEnvelopeBuilder.ts:162-164: getEffectiveContent "is also the routing/mention-detection text source, which must stay byte-faithful to what the user typed." So normalizing inside getEffectiveContent is NOT available — it would change what routing and mention detection see. The strip has to happen at each prompt-bound consumer, or behind a second explicitly-named accessor, with getEffectiveContent left byte-faithful. Whatever ships must also not drift from packages/common-types/src/services/conversationSyncDiff.ts:70, the DB-sync consumer of the same normalizer.

DEAD FIELD, colocated: ForwardedContentResult.content (forwardedMessageUtils.ts:279) has no reader. Per the admission bar this is do-it-now work for whichever PR opens this file, not a separate task. It is invisible to knip, which sees the field as used because the object literal is returned.

SIZE: re-label from M. Six sites, a shared util that cannot be changed in place, and a current-turn path make this at least two PRs — one for the current-turn/envelope half, one for the history/reference half. Split before building.

FIX-SHAPE CORRECTION #2, 2026-08-20 — SPLIT BY NORMALIZER HALF, NOT BY CODE PATH. This supersedes the "two PRs: envelope half / history half" line above and narrows the authorship-gate requirement recorded earlier.

normalizeMessageForContext is stripDmPrefix + stripBotFooters (discord.ts:544). Those two halves have VERY different safety profiles, and the reported bug is entirely the second one.

stripBotFooters — SAFE TO APPLY UNCONDITIONALLY to forwarded content. Every pattern in BOT_FOOTER_PATTERNS (constants/discord.ts:455-511) requires either a distinctive emoji plus an exact phrase (🆓 Using free model, 📍 auto-response, 🌱 Fresh Mode •, 🔒 Focus Mode •, 👻 Incognito Mode •) or the shape `-# Model: ` / `-# Transcribed by ` followed by a well-formed [text](<url>) markdown link. A human does not produce these by accident. The MODEL pattern already carries an explicitly documented ACCEPTED WIDENING whose stated cost is "the author's own quoted text missing from what is fed back to the model, not any cross-user effect" — which is precisely the forwarded-content case, already judged acceptable in this codebase.

stripDmPrefix — NOT safe. DM_PREFIX_PATTERN is /^\*\*[^*]+:\*\*\s*/ (discord.ts:484): any bold Name: opener, including a human's. This half is what makes the module docstring's "never mangles legitimate user content even if mis-applied" claim false, and correcting that claim stays in scope.

CONSEQUENCE — the split is footer-half vs prefix-half, and the FOOTER half needs no authorship signal at all:

PR 1 (the reported bug, and the whole of it): apply stripBotFooters to forwarded snapshot content at every prompt-bound member. Synchronous, no origin resolution, no REST, no async — so it lands cleanly at all six sites INCLUDING the current-turn envelope path, which cannot await an origin resolve. Correct the false docstring claim in the same PR.

PR 2 (smaller, lower severity, optional): the prefix half, gated on authorship. Only reachable where the resolved origin is in hand (the fetcher and persist paths); the envelope path structurally cannot do it without an await. Scope it to those, or decline it on merit.

This RETIRES the earlier note that the whole task needs the webhookId/bot-user authorship signal. That signal is needed ONLY for PR 2. PR 1 — the actual leak the owner observed — needs nothing but a synchronous strip.

Not a defect, checked so nobody re-checks: the payload quoted at the top of this task renders the footer as "- via Z.AI Coding Plan", which looks like it would defeat the MODEL pattern's " • " tail. buildModelFooterText emits ` • via ${providerLabel}` (constants/discord.ts:424-426) — a bullet. The hyphen is a transcription artifact in this task's own prose, and the tail is optional in the pattern regardless.
<!-- SECTION:DESCRIPTION:END -->
