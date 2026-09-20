---
id: TASK-841
title: >-
  Hoist the image-provenance label mapping into common-types so the two services
  cannot drift
status: Done
assignee: []
created_date: '2026-08-31 14:23'
updated_date: '2026-09-20 20:19'
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

CLOSED 2026-09-20 — PR #2458 merged (`b4fa61ac2`). Closing on a PARTIAL read of the acceptance text above, recorded per clause rather than rounded up, with the unmet half handed to TASK-1026.

- one source of truth for the PRECEDENCE — MET. `imageSource` now lives in `packages/common-types/src/utils/attachmentProvenance.ts` with every ai-worker importer re-pointed at it directly.
- one source of truth for the LABEL VOCABULARY — MET FOR EVERY EMITTER, NOT MET REPO-WIDE. `pickImageHeader` and `pickImageKind` are both gone, replaced by a single `imageHeaderLabel`, and `HEADER_LABELS` is the one list both services emit from. But two regex CONSUMERS still hand-spell the six labels — `allocationArms.ts` (grep `HEADER_RE`) and `mine-attachment-goldens.ts` — so adding a seventh label would leave both blind with no failing test. That is TASK-1026, filed with a verified positive-controlled sweep. The claude-review round independently re-ran both greps and confirmed the task text holds.
- the must-stay-in-step comments deleted in BOTH services — MET.
- no wrapper re-export files — MET. Nothing was left behind in `QuoteFormatter`; all five `imageSource` importers point at common-types.
- existing header tests stay green — MET, and canaried: swapping the sticker and link-preview mappings inside the hoisted `imageHeaderLabel` reddens the `[Sticker: …]` and `[Link preview: …]` cases in `RAGUtils.test.ts`, which also proves those tests resolve the hoisted module rather than a stale dist.

The fold-in question this task asked to decide either way: `QuoteFormatter`'s `imageSource`/`ImageSource` WERE folded in, and the structural parameter typing was KEPT. Its pre-move justification ("stays free of the Discord schema") does not survive relocation into the package that owns that schema, so the doc comment now carries the real reason, verified at the call sites: `AttachmentSource` declares `contentType` optional while `attachmentMetadataSchema` requires it, so it is not assignable to `AttachmentMetadata`, and the direct tests pass bare object literals. Worth recording that the spec driving this unit asserted a DIFFERENT reason — that narrowing would break the `ProcessedAttachment['metadata']` call site — and that was false: `MultimodalProcessor.ts` declares that field as `AttachmentMetadata`, so it is the same type.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. The duplication is still exactly as described — `pickImageHeader` (ai-worker) and `pickImageKind` (bot-client) independently implement the same three-way mapping, synced only by cross-referencing doc comments, no shared common-types helper exists. Evidence: `git grep -n "pickImageHeader\|pickImageKind" services/ai-worker/src/services/RAGUtils.ts services/bot-client/src/utils/attachmentPlaceholders.ts` → both still locally defined, comments still say "Must match RAGUtils' `pickImageHeader`."
---
<!-- COMMENTS:END -->
