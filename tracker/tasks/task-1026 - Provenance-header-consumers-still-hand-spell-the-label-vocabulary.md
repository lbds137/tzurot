---
id: TASK-1026
title: Provenance-header consumers still hand-spell the label vocabulary
status: To Do
assignee: []
created_date: '2026-09-20 19:36'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1022000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update 2026-09-23: the drift this task predicts has now happened. TASK-1053 (feat/task-1053-spoiler-labels-all-kinds) adds 'Spoiler file', 'Spoiler audio' and 'Spoiler voice message' to HEADER_LABELS (after 'Spoiler image' from TASK-1031), and neither hand-spelled parser below matches any spoiler label.

Why: the emitter side now reads one list. `HEADER_LABELS` in `packages/common-types/src/utils/attachmentProvenance.ts` is the single source both services emit from, pinned by a coverage test per service. The CONSUMER side does not read it: two functional sites still hand-spell the same six labels, so adding a seventh label to HEADER_LABELS silently leaves both of them blind to it, with no test that fails.

Verified, not assumed (sweep for the literal `Link preview` across `packages/` and `services/`, excluding tests and dist, positive-controlled against the known-present definition in attachmentProvenance.ts):
- `services/ai-worker/src/services/eval/allocationArms.ts` — grep `HEADER_RE`: a regex alternation spelling Image|Sticker|Link preview|Voice message|Audio|File.
- `packages/tooling/src/memory/mine-attachment-goldens.ts` — grep `Link preview`: the same six labels hand-spelled across two regexes and one SQL LIKE pattern.

Deliberately NOT in scope: `services/ai-worker/src/services/prompt/HardcodedConstraints.ts` spells several labels in OUTPUT_CONSTRAINTS prose, but that string is read by a model and has to scan as English, so driving it off an array would trade a real quality for a nominal one. `packages/common-types/src/types/schemas/discord.ts` and `RAGUtils.ts` mention labels only in doc-comment prose. Those three are correct as they stand.

How it arose: PR for TASK-1025 plus TASK-841 hoisted the emitters and their sanitizers into common-types. TASK-841 acceptance asked for one source of truth for the label vocabulary; that is now true of every EMITTER and not of these two parsers, so this is the remainder of that clause rather than a new idea.

Fix shape: export a derived matcher beside HEADER_LABELS rather than exporting the raw array to each parser, so the escaping lives in one place too. Something like a `headerLabelPattern()` returning the alternation with each label regex-escaped, plus a SQL-safe form if `mine-attachment-goldens` still needs one. Re-point both sites at it. Add one test asserting that appending a label to HEADER_LABELS changes the derived pattern, which is the assertion that makes the drift impossible rather than merely unlikely.

Acceptance: neither `allocationArms.ts` nor `mine-attachment-goldens.ts` contains a hand-spelled provenance label; a test fails if a label added to HEADER_LABELS does not reach the derived matcher; the three deliberately-excluded prose sites above are unchanged.
<!-- SECTION:DESCRIPTION:END -->
