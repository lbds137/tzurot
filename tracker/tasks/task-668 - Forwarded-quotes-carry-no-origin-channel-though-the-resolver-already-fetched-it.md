---
id: TASK-668
title: >-
  Forwarded quotes carry no origin channel, though the resolver already fetched
  it
status: To Do
assignee: []
created_date: '2026-08-19 00:47'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 668000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ask (2026-08-18), from a live prod prompt. A forward rendered as <quote type="forward" from="Unknown"> with no origin at all, while Discord own forward card shows the source channel and date to everyone who sees the message (screenshot: #lilith with a date, in a public channel). The model gets strictly less provenance than a human reader of the same message.

STATE OF THE TWO HALVES, so this is not re-solved from scratch:

- WHEN: already built. forwardedOriginSchema.timestamp (packages/common-types/src/types/schemas/message.ts) is captured off the snapshot with no network call in resolveForwardedOrigin (services/bot-client/src/utils/forwardedMessageUtils.ts), and formatForwardedQuote already threads timeFormatted into the t= attribute (services/ai-worker/src/services/prompt/QuoteFormatter.ts). It reads Unknown with no t= in prod only because #2141 merged to develop and has not shipped -- it lands with beta.205. Verify rather than rebuild.

- WHERE: genuinely missing, and cheap. resolveForwardedOrigin ALREADY reads reference.channelId and ALREADY fetches that channel -- it needs the id to fetch the original from the right place -- then discards the channel object. The name is in scope at the point the author is read off the fetched original.

ACCESS GATE, load-bearing: do NOT add the channel name ungated on the reasoning that Discord shows it publicly. That is unverified for a viewer LACKING access to the source channel, and one screenshot from a viewer who has access proves nothing about one who does not. Gate it behind the SAME viewer-access check authorPersonalityId uses (the Reply Loophole gate) -- resolveAuthorPersonalityId is already wired into this exact function and already receives the forwarder id and the isDM flag. That makes the unverified Discord-behaviour question moot instead of answering it.

Fix shape: add channelId plus channelName to forwardedOriginSchema (optional, fail-open like every other field there), populate both in resolveForwardedOrigin behind the access gate, render on the quote element. A DM origin has no channel name -- decide what it renders as rather than emitting an empty attribute.

Acceptance: a cross-channel forward renders its origin channel and original post time; a forward whose origin the FORWARDER cannot read renders exactly as it does today; the DM case is decided and pinned by a test.
ORCHESTRATOR DECISION 2026-08-20, overriding the ACCESS GATE paragraph above. The prescribed gate does not do what the paragraph assumes. resolveAuthorPersonalityId is replyResolver.resolveFromReferencedMessage, which returns null unless the ORIGINAL is one of OUR OWN personality messages (validateReferencedMessage requires a bot-user or webhook author) AND the viewer can load that personality (ReplyResolutionService.ts:208-241). It is a personality-visibility gate, not a channel-visibility gate. Reusing it would suppress the channel name on every forward of a HUMAN message, which is the common case, while never answering the question about a viewer lacking channel access.

Use a direct viewability check on the ORIGIN channel for the FORWARDER instead, failing closed. resolveForwardedOrigin already holds the fetched channel object and message.author.id. Probed against the shipped discord.js 14.27.0 typings (typings/index.d.ts:1838-1842): the GuildMember-or-Role overload returns a PermissionsBitField, while the RESOLVABLE overload (what a raw snowflake takes) returns Readonly<PermissionsBitField> or null, null being the not-resolvable-from-cache case. So: omit the channel attribute whenever permissionsFor returns null or lacks ViewChannel. Do not add a member fetch to rescue the null case - a cross-guild forward, where the forwarder is uncached, is also the case where they most likely have no access.

DM origin renders as NO channel attribute at all, not an empty one and not a literal. A DM has no channel name, and inventing a token would hand the model a fake identifier while adding no provenance a human reader of the same message has.

Render side is one line: formatQuoteElement builds its attributes from a data-driven attrDefs array (QuoteFormatter.ts:274-283), so the new attribute is one entry. Verify at build time whether guard:prompt-tags classifies attributes or only tags - it appears to be tags only, which would mean no registration is needed.
<!-- SECTION:DESCRIPTION:END -->
