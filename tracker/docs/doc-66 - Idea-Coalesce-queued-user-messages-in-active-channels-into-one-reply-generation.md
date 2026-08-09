---
id: doc-66
title: >-
  Idea: Coalesce queued user messages in active channels into one reply
  generation
type: other
created_date: '2026-08-09 17:21'
---

_Focus: when messages targeting an active character or activated channel arrive while a generation for that channel is already in flight, coalesce the pending messages into ONE follow-up generation instead of one LLM round-trip per message._

Owner report (2026-08-09, verbatim): "if multiple user messages targeting an active character or activated channel in Tzurot land while Tzurot is in the middle of generating replies for the given channel, I think we should maybe collapse pending messages so there are fewer round-trip calls to the LLM. I've run into this a lot where someone talks in a lot of short messages in an activated channel, which triggers multiple often repetitive outputs because right now we have it as one output per user message. I'm drawing inspiration from seeing how Claude Code queues user messages while the LLM is busy with something"

**Current behavior**: one generation job per triggering message. Rapid short messages (very common Discord chat style) produce multiple queued jobs, each seeing slightly more history, yielding repetitive near-duplicate replies and multiplied token spend.

**Owner refinement (2026-08-09): collapse stacks by USER ALTERNATION.** Only consecutive pending messages from the SAME author collapse — concatenated with line breaks (or whatever renders best) into one logical user message, because the target is a typing style (many rapid short messages = one thought). A message from a different user breaks the stack: never over-collapse across authors, so the LLM never loses sight of who is speaking and no user loses potential memory formation from their turns.

**Second owner note (same day): the alternation-stack vs a room-addressed reply is NOT settled as a binary.** The owner considered the "one reply addressing everyone" shape too; at pickup, run a council pass on the design space looking for a third option — some hybrid/blend (e.g. alternation-stacked prompt turns with a single reply that can address multiple stacks, or mode-switching on buffer composition). Design question, deferred to whenever this doc gets picked up.

**Scoping questions for build time**:

- **Where the coalescing seam lives.** Natural shape: key an "in-flight" marker on (channel, personality); while one generation runs, arriving trigger messages accumulate in a pending buffer instead of enqueuing jobs; when the in-flight job completes, one job per same-author run drains the buffer (a strict-alternation buffer may still produce multiple jobs — that is correct, per the refinement above). Candidate homes: bot-client (before enqueue — knows Discord arrival order, but multi-replica state needs Redis), api-gateway (queue layer — BullMQ job dedup/delay primitives live here), or ai-worker (at job start, absorb newer sibling jobs — riskiest for double-reply races).
- **Discord UX**: one reply addressing a same-author run — which message does the webhook reply anchor to (latest? none?).
- **Memory/history integrity**: the messages still land as separate history rows and separate memory-formation inputs per author; collapsing affects only how many GENERATION round-trips fire, never what gets recorded.
- **Correctness rails**: BullMQ retry/idempotency semantics for a drained buffer (spend-idempotency rule, `04-discord.md`); ordering guarantee that the buffer drains in arrival order; a cap so a flood coalesces into bounded prompt growth; interaction with the existing per-message dedup cache.
- **Scope boundary**: mentions/replies to a personality in non-activated channels may deserve the same treatment (same in-flight key) or may stay 1:1 — decide at scoping.

Related: `RedisDeduplicationCache` (existing per-message dedup), api-gateway `queue.ts` (job creation), conversation-history rows already store per-message turns so the coalesced prompt can render them faithfully.
