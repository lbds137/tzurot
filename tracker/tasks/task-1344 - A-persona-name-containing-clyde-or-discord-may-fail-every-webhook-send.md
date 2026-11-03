---
id: TASK-1344
title: A persona name containing clyde or discord may fail every webhook send
status: Done
assignee: []
created_date: '2026-11-03T00:36:00Z'
updated_date: '2026-11-03T03:56:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1327000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: WebhookManager getStandardizedUsername (services/bot-client/src/utils/WebhookManager.ts) sends the display name plus the bot suffix, and nothing in bot-client handles a refused name (git grep for clyde, USERNAME_INVALID and 50035 over bot-client src: no runtime hits). Machloket refuses webhook usernames containing clyde or discord with 50035, pinned in tests/e2e/machloket/messages.e2e.test.ts, and by memory real Discord does too (not probed). So a persona named for example Discord Helper would have DiscordResponseSender.ts sendAsPersonality throw, unverified end to end. The exact refusal of everyone and here does not reach this path, since the suffix makes the name not exact, unless the suffix is empty.

What: run a persona with such a name through the send path on Machloket, state what the user sees, then either fall back or rewrite the webhook name. How a name is altered is user-visible, so bring that to Lila with a recommendation if it is more than a fallback.

Acceptance: a persona whose name contains a blocked word still gets its reply delivered, pinned by a test at the send seam.

Provenance: claude-review on #2707, corrected against WebhookManager.

Ruling (Lila, 11-02): send under the normal name, and only when Discord refuses the username, retry once with a near-invisible tweak (plus a trim to fit the 80-character cap); names Discord accepts are never touched. Dev probe the same day, real Discord through the dev bot: Discord Probe and My Clyde Probe were refused with 50035 USERNAME_INVALID_CONTAINS; a zero-width space inside the word was still refused (Discord ignores it); a hair space (U+200A) inside the word was accepted and stored intact, lowercase, uppercase and clyde alike; 80 characters were accepted and 81 refused with BASE_TYPE_BAD_LENGTH. So the tweak is a hair space, which renders as a very thin gap rather than nothing.
<!-- SECTION:DESCRIPTION:END -->
