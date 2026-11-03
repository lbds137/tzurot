---
id: TASK-1344
title: A persona name containing clyde or discord may fail every webhook send
status: To Do
assignee: []
created_date: '2026-11-03T00:36:00Z'
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
<!-- SECTION:DESCRIPTION:END -->
