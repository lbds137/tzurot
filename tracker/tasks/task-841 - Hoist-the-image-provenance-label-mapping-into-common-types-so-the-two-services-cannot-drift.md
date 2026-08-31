---
id: TASK-841
title: >-
  Hoist the image-provenance label mapping into common-types so the two services
  cannot drift
status: To Do
assignee: []
created_date: '2026-08-31 14:23'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 841000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2270 reviews flagged (round 2 as informational, round 3 as a Low suggestion) that pickImageHeader (services/ai-worker/src/services/RAGUtils.ts) and pickImageKind (services/bot-client/src/utils/attachmentPlaceholders.ts) implement the same isSticker -> Sticker / isEmbedPreview -> Link preview / else Image mapping independently, synced only by cross-referencing doc comments — bot-client cannot import ai-worker, but the mapping depends only on AttachmentMetadata, which lives in common-types. Deferred out of the PR deliberately: at review round 3 a cross-package refactor (new common-types module, both services re-pointed, possibly folding QuoteFormatter imageSource into it) invites naming/placement churn a small rider should not carry.

Fix shape: a small common-types helper (utils or constants, media/attachment domain) exporting the provenance derivation and the display-label mapping; adopt at pickImageHeader, pickImageKind, and evaluate folding QuoteFormatter imageSource/ImageSource into it (its structural typing deliberately avoids the Discord schema — decide whether that constraint still pays once the helper lives in common-types, and record the call either way). Both existing test pairs move to pin the shared helper plus one thin per-site mapping test.

Acceptance: one source of truth for the precedence AND the label vocabulary; the must-stay-in-step comments in both services deleted; no wrapper re-export files; existing header tests stay green.
<!-- SECTION:DESCRIPTION:END -->
