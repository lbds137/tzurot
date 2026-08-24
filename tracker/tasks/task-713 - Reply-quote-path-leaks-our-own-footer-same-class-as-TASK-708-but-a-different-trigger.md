---
id: TASK-713
title: >-
  Reply-quote path leaks our own -# footer, same class as TASK-708 but a
  different trigger
status: Done
assignee: []
created_date: '2026-08-21 04:43'
updated_date: '2026-08-24 00:35'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 713000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by claude-review on PR 2168 (TASK-708 PR 1), which fixed the FORWARD trigger of this bug class. The REPLY trigger is untouched and produces the identical symptom the owner originally reported: our own subtext markup inside a quote block, which the model then roleplays around.

Mechanism, CODE-READ ONLY - no runtime observation yet, so treat the scenario as a hypothesis until a debug payload confirms it. MessageFormatter.resolveMessageContent's NON-forwarded branch (handlers/references/MessageFormatter.ts:56-65) builds reference content from raw message.content with no strip. Reply to one of our character messages -> ReplyReferenceStrategy -> ReferenceFormatter.appendSingleReference -> MessageFormatter.buildRawReference -> resolveMessageContent(message, isForwarded=false). The replied-to message is not itself a forward, so the forwarded branch this PR fixed is not taken. DiscordResponseSender appends the footer into the message text itself, so it is present in message.content of the fetched target.

WHY THIS WAS NOT FOLDED INTO PR 2168, on merit rather than convenience: the fix is NOT the one-line strip it looks like, because of how the footer is attached. appendFooterToChunks (DiscordResponseSender.ts:129-139) puts the footer on the LAST chunk only, and when it does not fit it pushes the footer as its OWN message (line 137). That yields three cases with different answers:

1. Single-chunk reply - footer sits inline in message.content. A strip is correct and sufficient. The common case.
2. Multi-chunk reply, reader replies to an EARLIER chunk - no footer present, nothing to do.
3. Footer overflowed into a standalone message - the entire message content IS the footer. Stripping leaves an EMPTY quote, so this needs a decision rather than a strip: drop the reference entirely, or render it as contentless. Adjacent to TASK-629 (image-only referenced messages render a contentless dedup stub), which is the same empty-reference question arriving from a different direction - check what 629 settles before deciding here.

Case 3 is what makes this its own unit of work. A rider on PR 2168 would have shipped the strip and silently produced empty quotes in case 3.

Also note the trigger is far more common than the forward path this fixes - replying to a character is ordinary usage - so the blast radius of getting it wrong is larger, which is a second reason it wants its own review round rather than arriving at round 3 of another PR.

Fix shape: apply stripBotFooters in resolveMessageContent's non-forwarded branch, the same prompt-bound reasoning PR 2168 records for the six forward sites, PLUS an explicit decision for case 3. Verify first that resolveMessageContent has no non-prompt consumer - PR 2168 established that its forwarded sibling is prompt-bound, and the two share a return value.

Acceptance: replying to one of our character messages renders a quote with no -# footer; the standalone-footer message case has a decided, tested behaviour rather than an empty quote; a replied-to HUMAN message whose text contains -# subtext keeps it, pinned by a test. No test currently exercises the non-forwarded branch with footer-shaped content, so the regression test is new coverage rather than an extension.
<!-- SECTION:DESCRIPTION:END -->
