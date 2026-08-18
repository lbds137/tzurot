---
id: TASK-649
title: >-
  Reply to a character webhook fires the character even when the reply-ping is
  disabled
status: To Do
assignee: []
created_date: '2026-08-18 00:18'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 649000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-08-17 (prod, #admin). Replying to a character webhook message with Discord's reply-ping toggled OFF still triggers the character. The ping toggle is the user-side signal for "I am not addressing you"; honoring it is the expected behavior.

Verified halves: (1) the inbound ping signal is never consulted -- every repliedUser/allowedMentions occurrence in services/ and packages/ is OUTBOUND send config (VoiceTranscriptionService.ts:177,432; PersonalityTriggerProcessor.ts:258); the reply trigger at PersonalityTriggerProcessor.ts:164-177 gates only on message.reference. (2) mentions.repliedUser is NOT the ping signal -- discord.js 14.27.0 Message.js:279 passes data.referenced_message.author unconditionally, so it is populated on every reply. The ping signal is membership in mentions.users (MessageMentions.js:267 relies on exactly that conjunction).

Fix shape: gate resolveReplyPersonality on the replied-to author appearing in message.mentions.users; fail OPEN when repliedUser is null (deleted/partial referenced message) since the toggle state is then unknowable.

OPEN QUESTION requiring a runtime capture, NOT code-reading: whether Discord includes a WEBHOOK author in the mentions array when the reply-ping is ON. If it does not, this gate suppresses every reply and is a severe regression. Confirm in dev (reply ping-on vs ping-off, observe mentions.users) BEFORE this reaches prod.

The open question has TWO failure directions, not one (the second surfaced from PR #2133 review item 3). If Discord omits a webhook author from mentions even when the ping is ON, the gate suppresses every reply. If Discord includes the replied author regardless of the toggle, the gate is inert and the bug is unfixed. BotMentionProcessor.ts:24-26 carries a comment asserting the latter ("Discord auto-includes author in mentions when replying", no mention of the toggle) and works around it with a content regex -- that comment is itself unverified and predates any toggle testing, so it is a hypothesis to check, not a conclusion.

Dev capture plan (the deployed debug log emits mentionedUserIds on the suppressed path; the existing "Multi-tag trigger resolved" line emits sources): (1) guild reply to a character webhook, ping ON; (2) same, ping OFF; (3) DM reply to the bot, ping ON; (4) same, ping OFF. Case 3/4 matter because the DM path is a real bot user rather than a webhook pseudo-user and may not share the webhook semantics. Also note whether the reporting channel was activated -- an activated channel answers via the activation trigger regardless, which the sources field distinguishes.

Acceptance: reply with ping ON triggers the character; reply with ping OFF does not; DM replies follow the same rule; both directions confirmed by the dev capture rather than by reading the code.
<!-- SECTION:DESCRIPTION:END -->
