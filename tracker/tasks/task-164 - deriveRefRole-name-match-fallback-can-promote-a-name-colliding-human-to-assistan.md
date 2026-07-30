---
id: TASK-164
title: >-
  deriveRefRole name-match fallback can promote a name-colliding human to
  assistant
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: low
ordinal: 164000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`deriveRefRole` name-match fallback can promote a name-colliding human to `assistant` in the fallback window

**Why:** `deriveRefRole` (`services/ai-worker/src/services/prompt/referenceRole.ts`) name-matches without a bot-authorship guard (dropped for symmetry with the stored path), so within the bounded fallback window a human whose display name prefixes a personality's would read as `role="assistant"`. Bounded: needs a name collision AND the reference lacking `authorRole` (pre-classifier stored history ~30d, or a rolling-deploy window). The module doc documents the tradeoff. **NOT fully bounded — forwarded refs are permanent**: the release-PR review (#1324) sharpened this — forwarded references (`SnapshotFormatter`, see the row below) NEVER carry `authorRole` because Discord strips `applicationId` from message snapshots, so a forwarded message whose author's display-name prefix-matches a personality reads as `role="assistant"` _indefinitely_, not just during the 30-day aging window. The aging closes only the stored-history path; the forwarded path stays open until the bot-authorship guard is threaded. **Fix shape (if needed)**: thread a bot-authorship signal into the fallback so only machine-authored refs name-match. **Promote when**: ~30 days after beta.136 ships (≈2026-07-24, when pre-classifier stored history has aged out and only the live deploy-window + permanent forwarded-ref paths remain) — re-evaluate whether the guard is worth adding, OR if a name-collision mislabel is observed. Surfaced 2026-06-24 by PR #1321 round-3 claude-review; forwarded-ref permanence sharpened by PR #1324 release review.

**GROUNDING 2026-07-30 — the "NOT fully bounded / forwarded refs are permanent"
escalation above is FALSE, on two independent grounds.** Verified in code, not
inferred:

1. **Forwarded refs carry no author name to collide with.**
   `SnapshotFormatter` (`services/bot-client/src/handlers/references/SnapshotFormatter.ts:103-104`)
   stamps `authorUsername`/`authorDisplayName` as `UNKNOWN_USER_NAME`
   (`'Unknown User'`), not the real author. A name collision needs a real name;
   there isn't one. Confirmed against installed discord.js 14.27.0:
   `MessageSnapshot` retains only attachments/client/components/content/
   createdTimestamp/editedTimestamp/embeds/flags/mentions/stickers/type — no
   `author`, no `applicationId`, no `webhookId`.
2. **The live forwarded path never calls `deriveRefRole` at all.**
   `ReferencedMessageFormatter` branches on `ref.isForwarded` into
   `formatForwardedReference`, which builds a `ForwardedMessageContent` and calls
   `formatForwardedQuote` — that helper hardcodes `from: 'Unknown'` and passes NO
   `role`. A live forwarded reference renders no role attribute whatsoever, so it
   cannot be promoted to `assistant` by any path.

Both grounds are now pinned by a test (`referenceRole.test.ts` — "resolves an
identity-stripped forwarded reference to user, never assistant"), so if the
placeholder ever changes to something a personality name could prefix, the test
fails rather than the reasoning silently rotting.

**Net: the item IS fully bounded, and its own promote-when date has passed**
(≈2026-07-24; pre-classifier stored history has aged out). The entire remaining
exposure is a rolling-deploy window of minutes that ALSO requires a human whose
display name prefixes a personality's. Whether that residual justifies threading
a bot-authorship guard is a quality/user-visible call and therefore the owner's,
per `06-backlog.md` — surfaced 2026-07-30, awaiting that call.
<!-- SECTION:DESCRIPTION:END -->
