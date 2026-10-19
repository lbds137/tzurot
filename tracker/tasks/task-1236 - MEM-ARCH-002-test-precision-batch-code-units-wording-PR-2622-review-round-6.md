---
id: TASK-1236
title: >-
  MEM-ARCH-002 test precision batch + code-units wording (PR 2622 review round
  6)
status: To Do
assignee: []
created_date: '2026-10-16 06:23'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1224000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2622 review round 6 left three test/doc precision Lows and two nits at the round cap - filed, not iterated. All reference the shipped excerpt arm.

(1) Stale @spec comment: MemoryFormatter.test.ts ~L462 still reads '@spec MEM-ARCH-002: split mode omits the assistant part of every parseable row' - the amended rule carves out MEM-ARCH-038/021. (2) The reworked MEM-ARCH-002 test lost its positive assertion: restore toContain('hi') (user turn renders) and add one formatter-level test that an own no-summary doc's tag body contains 'Nova: <excerpt>' (the excerpt is currently asserted only via renderSplitNoteBody directly and the excerptNotes count). (3) ARCHIVE_ASSISTANT_EXCERPT_CAP_CHARS JSDoc + MEM-ARCH-038 should say '700 UTF-16 code units' (text.length counts code units; emoji-heavy prose yields fewer visible chars) so a later reader does not 'fix' it to code points. (4) Schema comment date drift: the assistantSummary doc line says 'D2 as amended 2026-10-15' - align with the design doc's 'ruling 2026-10-12, amendment written 2026-10-15'. (5) Post-deploy watch rider: if the excerptNotes share comes in well below the ~13% no-summary share, quote stripping eating whole excerpts (in-character blockquotes) is a likely cause - fold into the beta.237 telemetry look.

Item (1) shipped in PR 2632 (TASK-1240): the MemoryFormatter.test.ts @spec MEM-ARCH-002 comment now names the done-summary and own-note-excerpt exceptions. Items (2)-(5) remain.
<!-- SECTION:DESCRIPTION:END -->
