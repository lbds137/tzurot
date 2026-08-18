---
id: TASK-656
title: Forwarded messages reach the model unattributed
status: To Do
assignee: []
created_date: '2026-08-18 12:20'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 656000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a forwarded message reaches the model as `<quote type="forward"
from="Unknown">` with no author, no id, and no timestamp. Verified at the
PROMPT layer from an owner-supplied inspect dump (COLD, trigger
1539246664223555695, 2026-08-18) -- not inferred from Discord payloads, which
was an earlier wrong-layer reading in the same session.

Observed rendering, exact:

    <quote type="forward" from="Unknown">
    <content>...327 chars, complete...</content>

Compare a normal history element, which carries all three:

    <message from="Lila" from_id="5724..." role="user" t="2026-08-09 (Sun) 11:24">

Three separate omissions, with DIFFERENT costs to fix:

1. AUTHOR -- `from` is the hardcoded literal `Unknown` in
   `formatForwardedQuote` (services/ai-worker/src/services/prompt/
   QuoteFormatter.ts:461-469). Its comment says the forwarding message carries
   no author "so `from` is a literal here rather than a dropped field", which
   is true of the SNAPSHOT and false of the forward as a whole: Discord omits
   author and id from message_snapshots but supplies
   message_reference.message_id + channel_id. Fetching that message returns
   the original author id, display name, timestamp and full content --
   verified live against the #rotzot forward. Cost: one REST fetch.

2. TIMESTAMP -- a pure drop, NO fetch needed. `formatQuoteElement` already
   supports a `t=` attribute (QuoteFormatter.ts:257) and
   `SnapshotFormatter.formatSnapshot` already populates
   `timestamp: snapshot.createdTimestamp` with a fallback
   (services/bot-client/src/handlers/references/SnapshotFormatter.ts:120).
   `formatForwardedQuote` simply never passes one, and
   `ForwardedMessageContent` has no field to carry it. Cheapest of the three
   and independently shippable.

3. ROLE -- `SnapshotFormatter.formatSnapshot` sets UNKNOWN_USER_DISCORD_ID /
   UNKNOWN_USER_NAME (lines 115-117) and deliberately assigns no authorRole,
   so a forwarded PERSONA message reads as role="user" rather than assistant.
   Already documented in that comment as a known limitation; resolving (1)
   fixes this too.

Provenance caution: surfaced by a character LLM describing its own context.
Three of its four claims held (Unknown sender, no message id, no timestamp);
the fourth -- "content truncated at the model indicator line" -- is FALSE. The
content is 327 chars, byte-length-identical to the original, and ends with the
model footer line; the model read completeness as truncation. It also asserted
the reply-ping bug was "still active, fix undeployed", which is a narrative
reconstructed from conversation history and wrong (TASK-649: no signal exists).
An LLM self-report is a lead, not a spec -- verify each claim at the layer that
matters before acting on it.

NOT verified: whether `<quote type="reply">` elements carry `t=`. The dump
contained no reply quote, so the model's claim that "standard reply-references
preserve author, timestamp, and full text" is unchecked. Check before assuming
forwards are the only gap.

Fix shape: start with (2) -- plumb the snapshot timestamp through
ForwardedMessageContent into formatForwardedQuote. Then (1) -- resolve
message_reference.message_id to attribute the quote, failing OPEN to the
current Unknown behaviour when the original is deleted or unreadable.

Acceptance: a forwarded message renders with its original author and a `t=`
attribute; a test pins the unresolvable-original fallback to today's output.
<!-- SECTION:DESCRIPTION:END -->
