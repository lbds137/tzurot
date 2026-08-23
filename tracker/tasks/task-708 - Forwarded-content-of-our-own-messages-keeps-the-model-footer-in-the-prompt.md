---
id: TASK-708
title: Forwarded content of our own messages keeps the -# model footer in the prompt
status: Done
assignee: []
created_date: '2026-08-20 22:28'
updated_date: '2026-08-23 05:24'
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
PR 1 SHIPPED - PR 2168, opened 2026-08-21. All six prompt-bound members switched via two new accessors (extractForwardedContentForPrompt, getEffectiveContentForPrompt); the two byte-faithful non-members carry in-place comments; the false normalizeMessageForContext docstring claim corrected; the colocated dead surface removed. The acceptance clauses above are met at the unit level, clause 1 pending the queued runtime smoke. Do not close this task on the merge.

PR 2 FIX-SHAPE CORRECTION #3, 2026-08-21, found while deciding whether PR 2 is worth building. THE RECORDED AUTHORSHIP GATE IS INSUFFICIENT, for the third time on this task and the same reason as the first two: the proposed signal answers a different question than the one that decides the case.

The correction above says to gate the prefix half on authorship - webhookId, or an author id equal to our own client user id - because our own markup is ours to strip. That reasoning holds for the footer half and does NOT carry to the prefix half, because TWO different code paths emit a bold Name: prefix and WE WROTE BOTH:

1. DiscordResponseSender.ts:181 - a personality response in a NON-webhook channel (the DM case): `**${personality.displayName}:** ${content}`. The name is OUR CHARACTER'S. Stripping a forward of this is correct - the quote element already carries from=, so the prefix is duplicate attribution.

2. characterTurn.ts:239 - the relay echo of the USER'S OWN slash-command input: `**${displayName}:** ` where displayName is the HUMAN'S. The name is the USER'S. Stripping a forward of this DELETES the only attribution the text carries, and the quote's from= names the bot/webhook rather than the human - so the strip actively LOSES information rather than cleaning it.

Both messages pass any authorship check, so authorship cannot separate them. The discriminator is which of the two paths wrote it, resolved from the message's author/registry status - exactly the distinction DiscordChannelFetcher.ts:475's existing comment already draws for extractMessagePrefixName ("for an assistant DM response it's the personality's display name; for a relay-echo of user input it's the USER's display name"). Any PR 2 must reuse that classification, not invent an authorship test.

AGENT RECOMMENDATION, owner call: DECLINE PR 2 on merit, and archive this task once PR 1's smoke passes. The reasons are severity and asymmetric risk, not effort:
- The remaining defect is a duplicated display name inside a quote that already carries from=. That is a prompt-tidiness nit, not the markup leak the owner reported.
- Case 2 makes a wrong answer LOSE the human's attribution, which is strictly worse than the nit being fixed. The failure directions are asymmetric.
- The classification signal exists only where a resolved origin is in hand, so PR 2 structurally cannot cover the current-turn envelope path. It would ship a partial that is inconsistent across paths - the exact shape PR 1 was designed to avoid.
Surfaced rather than decided because the boundary rule fails closed and this touches what the model sees. If the owner would rather have it, build it against the classification above, scoped to the fetcher and persist paths, and record the envelope-path gap as deliberate.
CLASS ENUMERATION CORRECTION, 2026-08-21, from PR 2168 review round 1. The CLASS ENUMERATION section above lists SIX members and presents them as the class. It is SEVEN. The missing member is handlers/references/SnapshotFormatter.ts:118, which builds reference content from snapshot.content DIRECTLY.

Why that enumeration missed it, which is the transferable part: every member it found was found by tracing extractForwardedContent and getEffectiveContent - i.e. by FUNCTION. SnapshotFormatter calls neither. It reads the snapshot field itself, so it is invisible to any search keyed on the accessors' names, and the PR's survivor grep inherited exactly the same blind spot and reported clean. Per 00-critical.md's Grep Rule the pattern was never positive-controlled against a known-present instance; had it been, the boundary assumption would have failed immediately.

The member is not obscure. It is reached via ReferenceFormatter.appendForwardedSnapshots whenever a forward reference is NOT already deduplicated - the ordinary first-crawl case (replying to, or linking to, a forward) - and it is the path that renders a quote block, which is the exact surface the original report showed. The report's "two separate quotes in the one payload carried it" is consistent with one quote from the MessageFormatter path and one from here.

The correct enumeration key for this class is BEHAVIOUR: every direct read of a forwarded snapshot's content. Swept that way across non-test bot-client/src, the class closes at those seven members plus non-prompt hits (the accessors' own internals, comment prose, and one debug log line now tracked under doc-80).

NOTE for anyone re-reading the NON-MEMBERS list above: it remains correct. LinkReferenceStrategy and the mention-detection call are genuine non-members and shipped unchanged, each with an in-place comment saying why.
PR 1 MERGED 2026-08-21 - PR 2168, five commits, 17 files. DELIBERATELY NOT CLOSED; see the per-clause assessment below.

Acceptance, per clause:
1. "no -# footer in the extended-context path, the persisted path, and the reference-quote path" - MET AT THE UNIT LEVEL for all three, plus the current-turn envelope path the clause does not name and the SnapshotFormatter fan-out path this task's own enumeration missed. NO RUNTIME OBSERVATION EXISTS. Smoke item queued in CURRENT.md under the beta.206 batch. This is the same gap that made TASK-706 worth smoking, and this bug class is specifically "the code looked right and the path never ran", so the clause is not signed off until the owner smokes it.
2. "a forward of a human message whose text opens with a bold Name: prefix keeps it, pinned by a test" - MET. stripDmPrefix is deliberately NOT applied; a test pins the prefix surviving.
3. "the false docstring claim is corrected" - MET. normalizeMessageForContext now states per sub-function which one is safe if mis-applied and which is not, instead of claiming both are.

Also shipped, beyond the acceptance: the colocated dead surface (extractAllForwardedContent, ForwardedContentResult, extractForwardedEmbeds - four dead fields, not the one this task named), a negative control pinning that the byte-faithful accessor does NOT strip, a seam test distinguishing the two accessors at the mention-detection call site, and two corrected consumer lists (BOT_FOOTER_PATTERNS named a module that no longer strips at all).

PR 2 - STILL OPEN AS A DECISION, not as work. The agent recommendation to DECLINE ON MERIT stands and is argued in the block above; the owner has not ruled. Nothing further should be built for this task until that call is made.

CLOSE THIS TASK when clause 1's smoke passes AND the PR 2 decision is recorded. Not before.
PR 2 FIX-SHAPE CORRECTION #4, 2026-08-21, after a four-model council pass. THIS SUPERSEDES THE
AGENT RECOMMENDATION TO DECLINE, and redefines what PR 2 IS rather than closing the task. PR 2 was
always "the prefix half"; only its mechanism changes here, for the fourth time and for the same
recurring reason -- the previously recorded signal answered a different question than the one that
decides the case.

COUNCIL RESULT (GLM 5.2, Kimi K3, Qwen 3.8 Max, DeepSeek v4 Pro; all four answered):
- 4-0: DECLINE the strip AS SPECIFIED. The asymmetry argument recorded above holds and was
  independently reconstructed. Do not ship an authorship-gated or unconditional prefix strip.
- 3-1: a better third option exists, which all three proposed INDEPENDENTLY without prompting.

THE NEW PR 2 -- strip the bold prefix ONLY when it MATCHES the quote element's from= value.
  from="Lilith" + text opening "**Lilith:**"  -> match    -> strip; the prefix is pure duplication
  from="Bot"    + text opening "**Alice:**"   -> mismatch -> KEEP; the prefix is the only attribution
It needs no authorship test and no origin resolution, because the CONTENT itself answers the
question the authorship signal kept failing to answer. It fails safe by construction: any
resolution oddity yields a mismatch, which keeps the prefix, which is exactly today behaviour.

WHERE IT GOES, and this is the part that dissolves the objection that killed the earlier shapes:
services/ai-worker/src/services/prompt/QuoteFormatter.ts. formatQuoteElement receives BOTH from and
the content in one call (verified at QuoteFormatter.ts:284-292, the attrDefs array). Every earlier
correction assumed the strip had to happen in bot-client at extraction time, where the origin is not
yet resolved -- that assumption, not the mechanism, was the blocker. Rendering time has both values
already in hand.

THE DISSENT, recorded because it is worth re-examining rather than dismissing: DeepSeek v4 Pro said
no clean third option exists, and that the duplication persists where it matters most -- the
current turn. Its reasoning rests on a premise supplied IN THE QUESTION by the agent ("the
current-turn path is synchronous and cannot await an origin lookup"), which did not survive the
QuoteFormatter check above. Weight the 3-1 accordingly; a dissent resting on a premise that
falsified is weaker than its vote count suggests.

VERIFIED 2026-08-21, closing the question this block used to pose: the current turn carries NO from=.
rawMessageContent becomes messageContent at ContextAssembler.ts:342 and is delivered as the turn's own
content, never wrapped in a quote element. So the duplicate-attribution defect CANNOT occur on that
path -- it is not an uncovered gap. PR 2 scoped to QuoteFormatter is therefore COMPLETE rather than
partial, which removes the cross-path inconsistency objection that weighed against earlier fix shapes.

SEPARATE DEFECT FOUND WHILE VERIFYING THAT, deliberately not folded in -- it is a different shape, and
folding it in would repeat this task's own history of creeping scope. When a user forwards one of our
DM-style persona replies AND triggers a character in the SAME message, the snapshot text becomes the
current turn with the persona prefix intact: rawMessageContent = "**Lilith:** ..." delivered as the
USER's turn. getEffectiveContentForPrompt applies stripBotFooters (#2168) but deliberately not
stripDmPrefix, so the prefix survives.

That is NOT duplicate attribution -- there is no second copy of the name to remove -- it is a persona
prefix sitting inside a human's turn, which is arguably worse to read than the duplication PR 2
targets. NOT ASSERTED AS HARMFUL: this is code-reading, no runtime observation exists, and whether the
model actually mis-reads the speaker depends on how the turn is framed around it. Per 00-critical that
makes it a hypothesis, not a finding. Reachability is also unmeasured -- it needs a forward of a
NON-webhook persona reply (the DM path) plus a trigger in the same message. Assess before filing.

ALSO WORTH KEEPING from the pass, both arguments the agent did not have:
- A MISMATCH IS SIGNAL, not noise (Qwen). from="Bot" with "**Alice:**" means the bot relayed Alice.
  Kimi extends this: the mismatch branch could REWRITE from= to name the human, which would make the
  relay-echo case BETTER than today rather than merely unharmed. Optional, and a separate decision.
- The partial-coverage instinct recorded above was right for the WRONG reason (Kimi). The model does
  not care about cross-path inconsistency; the real hazard is governance -- a strip that works on
  some paths gets "cleaned up" into uniform application by a later refactor, which is precisely how
  the dangerous version of this proposal arose in the first place.
- Three of four noted the duplication may be mildly LOAD-BEARING: **Name:** is the form models parse
  most natively for speaker identity, and it survives consumers that flatten or truncate the XML
  envelope. That is an argument for keeping PR 2 narrow, not for abandoning it.

STATUS: PR 2 is now a DEFINED UNIT rather than an open owner decision. Owner ruled 2026-08-21 that
the task should be rewritten to the new plan rather than closed and re-filed.

PR 2 SHIPPED 2026-08-21 - PR 2175, merged 87bf8a467. The match-gated strip landed in
formatQuoteElement per the council shape, via the existing extractMessagePrefixName/stripDmPrefix
primitives. Review rounds added: a fromFallback option so formatForwardedQuote's 'Unknown'
placeholder renders the from= attribute WITHOUT entering the comparison (an unresolved origin can
no longer strip a literal **Unknown:** opener - the round-1 Medium, confirmed and fixed), the
two prefix regexes consolidated to one capturing pattern (sync dependency deleted), and the
ACCEPTED RESIDUAL doc naming all three bounded residual sources (self-signature, placeholder rows,
replayed-history name drift). The from=-rewrite-on-mismatch idea stays unbuilt, recorded above.

The PR 2 decision clause is now RESOLVED (shipped, not declined). CLOSE THIS TASK when clause 1's
smoke passes - that is the only remaining condition. The smoke item in CURRENT.md carries a rider:
watch for a real user's own **Name:** self-signature being stripped inside a quote (the one
user-visible behavior change PR 2 introduces; accepted residual, bounded by from= attribution).
<!-- SECTION:DESCRIPTION:END -->
