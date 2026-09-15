---
id: doc-102
title: 'Idea: Honor reply structure in history so the model sees what a human sees'
type: other
created_date: '2026-09-15 02:00'
---

# Idea: Honor reply structure in history so the model sees what a human sees

## The goal (owner direction, 2026-09-15)

A human reading the Discord channel sees every reply with its little preview of
the message it answers, and can click through to the original. The model should
have as close to that same picture as we can give it. Today it does not, and the
consequence is the model misreading what is going on — an answer floating with
no visible question.

Owner's stated shape: honor whatever replies exist in the channel under extended
context; where the replied-to message is NOT in the history window, include it
artificially so the pointer resolves. **Chronology must be preserved** — that
part is not negotiable.

TASK-987 (a persona ping not inheriting the reply reference from the users
preceding message) is one SYMPTOM of this, and becomes a member of this idea
rather than a standalone fix.

## What is already built (verified by reading, 2026-09-15)

Three of the moving parts exist. This is the main reason to scope before
building.

1. **History rows already render their quotes.** `formatQuotedSection`
   (`services/ai-worker/src/jobs/utils/xmlMetadataFormatters.ts`) takes a
   `StructuredHistoryEntry` and reads `msg.messageMetadata?.referencedMessages`
   — not just the triggering message — and emits a `<quoted_messages>` block
   inside that turn. So a history row that CARRIES a reference already renders
   one.
2. **The in-window question is already computed.** The same function splits
   references into `fullRefs` and `dedupedRefs` using a `historyEntries` map
   keyed by Discord message id, and `dedupeReference` projects an already-visible
   quote down to a lightweight stub so the prompt does not carry the same text
   twice. The predicate this idea needs — is the replied-to message already in
   the window — is exactly what that split answers.
3. **The channel fetcher builds `messageMetadata.referencedMessages`** for fetched
   rows, at least for link-resolved references
   (`services/bot-client/src/services/channelFetcher/messageMetadataBuilder.ts`,
   grep `Merge resolved link references`).

## What is NOT yet verified — ground this first

Whether channel-fetched history rows capture REPLY pointers (as opposed to link
references) has NOT been checked. That single question decides whether this idea
is mostly a capture-side gap or mostly a rendering-side one, so it is the first
thing a grounding pass answers. Do not design past it.

## The design question worth settling before any build

The owner named two mechanisms, and they are alternatives rather than a pair:

- **(a) Inline preview at the reply** — what `<quoted_messages>` already does,
  and what Discord actually shows a human. The quote travels WITH the message
  that replies to it.
- **(b) Hoist the out-of-window original to the earliest point in history** —
  closer to the click-through-and-scroll-back affordance.

Note there is no chronology CONFLICT in (b): you cannot reply to a future
message, so an out-of-window reply target is always older than the window and
placing it first IS chronological. Ordering among several hoisted messages is
the only ordering decision.

But (a) and (b) together duplicate content, and (a) is both already built and
the closer analogue to what a human sees. **Recommendation: make (a) work
everywhere first** — every history row that is a reply carries its preview —
and treat (b) as a separate, later question about long reply chains, where
chronological grounding is the thing the inline preview cannot give.

## Risks to size before committing

- **Token budget.** Every replying row in a busy channel can pull in an extra
  message. Needs a per-turn cap and it must compose with the existing dedup,
  not fight it.
- **Reach-back depth.** A reply to a three-month-old message is technically
  resolvable and probably not worth resolving. Needs a policy, not an accident.
- **A hoisted message reads as a non-sequitur** if it arrives with no
  surrounding context and nothing marking why it is there.
- **Fetch cost.** Resolving an out-of-window reply target may mean a Discord
  fetch per row; the existing reference crawler already has BFS depth limits
  worth reusing rather than reinventing.

## Disposition

Filed as an idea doc rather than a task because it needs scoping and because
three components already exist — the wrong shape here rebuilds what is there.
**Not in beta.225**, whose cut criteria are the timezone cluster and the
rotation work. Candidate for beta.226.
