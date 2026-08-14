---
id: TASK-34
title: >-
  Consider a marker-count/length cap on dedup reply-stubs (10-attachment worst
  case)
status: To Do
assignee: []
created_date: '2026-07-01 00:00'
updated_date: '2026-08-14 22:45'
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
<!-- SECTION:DESCRIPTION:END -->
