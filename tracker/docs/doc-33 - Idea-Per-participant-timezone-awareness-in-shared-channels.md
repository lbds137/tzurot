---
id: doc-33
title: 'Idea: Per-participant timezone awareness in shared channels'
type: other
created_date: '2026-07-28 11:11'
---

## Per-participant timezone awareness in shared channels

_Surfaced 2026-07-07 (owner question during UX-boulder session). Prompt-assembly territory (boulder #2's domain)._

**Problem (grounded)**: the prompt's `<datetime>` is `formatFullDateTime(new Date(), context.userTimezone)` (`PromptBuilder.ts:226`) — the INVOKING user's timezone. In a shared channel the character's clock teleports every turn (Alice in Tokyo prompts → 10 AM Tuesday; Bob in NYC replies → 9 PM Monday) with no attribution — temporal-continuity confusion, and the character confidently asserts the wrong local time to the other user. Memory timestamps formatted the same way amplify it.

**Fix shape (two moves)**: (1) anchor `<datetime>` to ONE stable reference per conversation (server time or channel-dominant zone) so the clock never teleports; (2) per-participant local-time hints in the `<participants>` block — emit the COARSE local time ("evening, ~9 PM"), NOT the IANA zone name (timezone is location-ish; injecting it into shared-channel prompts makes it inferable by everyone — privacy call to confirm with owner at build). Plumbing partially exists: participants blocks carry per-user personas; `userTimezone` rides the job payload.

**Promote when**: prompt-assembly-architecture phases touch the participants formatter, or the confusion bites in prod (a character asserting wrong local time to a user).

