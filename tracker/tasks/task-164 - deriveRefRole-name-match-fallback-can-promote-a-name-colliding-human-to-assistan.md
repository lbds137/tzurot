---
id: TASK-164
title: 'deriveRefRole name-match fallback can promote a name-colliding human to assistant in the…'
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
labels:
  - 'area:ai-worker'
dependencies: []
ordinal: 164000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`deriveRefRole` name-match fallback can promote a name-colliding human to `assistant` in the fallback window

**Why:** `deriveRefRole` (`services/ai-worker/src/services/prompt/referenceRole.ts`) name-matches without a bot-authorship guard (dropped for symmetry with the stored path), so within the bounded fallback window a human whose display name prefixes a personality's would read as `role="assistant"`. Bounded: needs a name collision AND the reference lacking `authorRole` (pre-classifier stored history ~30d, or a rolling-deploy window). The module doc documents the tradeoff. **NOT fully bounded — forwarded refs are permanent**: the release-PR review (#1324) sharpened this — forwarded references (`SnapshotFormatter`, see the row below) NEVER carry `authorRole` because Discord strips `applicationId` from message snapshots, so a forwarded message whose author's display-name prefix-matches a personality reads as `role="assistant"` _indefinitely_, not just during the 30-day aging window. The aging closes only the stored-history path; the forwarded path stays open until the bot-authorship guard is threaded. **Fix shape (if needed)**: thread a bot-authorship signal into the fallback so only machine-authored refs name-match. **Promote when**: ~30 days after beta.136 ships (≈2026-07-24, when pre-classifier stored history has aged out and only the live deploy-window + permanent forwarded-ref paths remain) — re-evaluate whether the guard is worth adding, OR if a name-collision mislabel is observed. Surfaced 2026-06-24 by PR #1321 round-3 claude-review; forwarded-ref permanence sharpened by PR #1324 release review.
<!-- SECTION:DESCRIPTION:END -->
