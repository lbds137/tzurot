---
id: TASK-34
title: >-
  Consider a marker-count/length cap on dedup reply-stubs (10-attachment worst
  case)
status: To Do
assignee: []
created_date: '2026-07-01 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'origin:review'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Consider a per-attachment cap on dedup reply-stubs (10-attachment worst case)

**Why:** A "lightweight" dedup stub has no upper bound on its attachment cost. Worst case: a reply-target with Discord's max 10 attachments, each with a long filename.

**Mechanism CHANGED by #1882 (TASK-365 PR-2) — the concern survives, its shape does not.** The original filing was about `[contentType: name]` text markers folded into the stub's content by `buildDedupedReferenceStub`, which deliberately preserved every marker in full. That code is gone: the stub is now a projection of the full render, so each attachment is a structural element (`<image filename="x.png" type="image/png" status="undescribed"/>`). That is MORE characters per attachment than the marker was, not fewer — so re-measure before deciding this is worth doing.

**Fix shape** (unchanged in principle): cap the attachment COUNT rather than truncating filenames, which are the correlation hint. `renderReference`/`dedupeReference` in `services/ai-worker/src/services/prompt/RenderableReference.ts` is the one place it would go, and it would apply uniformly to both source paths for the first time.

**Owner call, not an agent's**: it is a token-budget/prompt-shape decision.

**Promote when**: attachment-heavy stubs observed bloating prompts. Surfaced 2026-07-01 (PR #1431 post-squash review); mechanism restated 2026-07-31 (#1882).

## Merged from TASK-161 (2026-10-12)

TASK-161 (priority low, state:observable, same dedup-stub family): the dedup time-fallback can mislabel a proximity-matched message as the reply-target. `isDuplicateReference`'s time-based fallback marks a reference `isDeduplicated` when a recent webhook/bot message falls within `MESSAGE_TIMESTAMP_TOLERANCE`, by timestamp proximity rather than exact id. If the proximity-matched history row is not the exact message being replied to, the deduped stub's marker (`[Referenced message — full text in <chat_log>]`) points at text that is not actually in `<chat_log>`. Low probability (tight tolerance); PR #1317 did not change the fallback. Digest pass 2026-09-04 (RETARGET): the shared `isDuplicateReference` kernel now lives in packages/common-types/src/utils/referenceEnrichment.ts, and the premise is intact: exact-id and timestamp-proximity matches collapse into one boolean, so a caller cannot tell which justified the reference claim. Fix shape: prefer exact-id match and fall back to proximity only when no id match exists, or drop the "full text in chat_log" marker when the match was proximity-based. Promote when: a mismatched-reference incident is observed, or when reworking the dedup fallback (naturally the same pass as the RenderableReference.ts attachment cap above). Surfaced 2026-06-23.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): RETARGET. Same rewrite as TASK-61: the cap, if wanted, goes in RenderableReference.ts (dedupeReference/renderReference). Keep the task's own re-measure-first step as step one; the owner call on prompt shape follows the measurement.
---
<!-- COMMENTS:END -->
