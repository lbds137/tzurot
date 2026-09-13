---
id: doc-100
title: 'Idea: Per-message rating reaction that records the request id'
type: other
created_date: '2026-09-13 17:24'
---


### Idea: Per-message rating reaction that records the request id

_Source: the shapes.inc announcements mined 2026-09-13. Their April 2026 update added 👍/👎 on character messages with follow-up actions (switch engine, clear short-term memory, tweak instructions). Tzurot has `/feedback` (owner-triage rows in `user_feedback`) but no per-message signal._

**Why it fits.** The value is measurement, not the buttons. doc-97 measures voice drift through proxies (exclamation marks per 1k chars, a courtroom vocabulary count) because nothing labels a reply as "that is not her". A thumbs-down that records the reply's request id gives a labeled set the drift work can score against, and the request id already links to the diagnostic payload, the usage row, and `/inspect`, so a rated reply is fully inspectable without storing content.

**Shape (first slice, measurement only):**
- bot-client: a reaction listener on bot replies for 👍 / 👎 from the user the reply addressed (or any participant — owner call at build time; default: the addressed user). On match: gateway POST with `{ requestId, messageId, personalityId, userId, rating }`; ephemeral one-line acknowledgement; no follow-up buttons.
- gateway: a small `message_ratings` table (request id, message id, personality id, user id, rating, created_at; unique on message id + user id so a changed mind overwrites) — or a `kind` column on `user_feedback` if the owner prefers one table; decide at build time by reading `user_feedback`'s shape.
- ops: `pnpm ops ratings:report --env prod --since 7d` — thumbs-down rate per character per week, with the request ids so the owner can `/inspect` any of them. This report is the deliverable; the reaction is its input.
- Privacy: the rating and ids only; no message content; the existing diagnostic retention governs what the request id can still reach.

**Not in scope:** the follow-up actions (regenerate, switch preset, clear memory) — each is its own feature; public aggregate display; anything creator-facing.

**Acceptance sketch:** a 👎 on a prod reply produces one row carrying the reply's request id; the report lists it under the character; a second reaction by the same user replaces the first.
