---
id: TASK-1375
title: >-
  Provenance neutralizer: a zero-width or format character between a look-alike
  opener and the label defeats it
status: To Do
assignee: []
created_date: '2026-11-09T21:55:00Z'
labels:
  - area:common-types
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1358000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: neutralizeHeaderMarkers in packages/common-types/src/utils/attachmentProvenance.ts strips an opener run only when <Label>: follows it directly (grep HEADER_OPENER_RUN). A fullwidth opener, then U+200B (or another \p{Cf} format character), then Image: passes through, so model output can still mint a header the model may read as authoritative. The doc comment states this as an unpinned limit. claude-review on PR 2733 called it the cheapest remaining bypass for model output.
Fix shape: allow optional \p{Cf} characters between the opener run and the label in the lookahead and strip them with the run; or remove \p{Cf} from the description text before the neutralizer runs. Pin it with a test (fullwidth opener, U+200B, Image: x defused), and drop the limit sentence from the doc.
Acceptance: the zero-width case is defused and tested; the doc no longer lists it as a limit; existing tests stay green.
<!-- SECTION:DESCRIPTION:END -->
