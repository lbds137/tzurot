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
<!-- SECTION:DESCRIPTION:END -->
