---
id: TASK-1377
title: >-
  Provenance kept-quote set misses U+2E42; fix the five-quotes doc wording and
  kept-four naming
status: To Do
assignee: []
created_date: '2026-11-10T01:12:00Z'
labels:
  - area:common-types
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1360000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2733 (TASK-1027) keeps the quotation marks that Unicode files under Ps/Pe (owner ruling 2026-11-09), but its kept set (KEPT_CHARACTER_CLASS in packages/common-types/src/utils/attachmentProvenance.ts) lists five: U+201A, U+201E, U+301D, U+301E, U+301F. A python3 unicodedata enumeration (Unicode 16) of Ps/Pe characters named QUOTATION finds eight. U+2E42 (double low-reversed-9 quotation mark) is a quote the ruling covers and is still stripped; Node 24 (Unicode 17) agrees it is Ps. U+276E and U+276F (heavy angle quotation mark ornaments) stay STRIPPED by a second owner ruling (they are bracket-shaped dingbats), so they are not part of this task. The doc comment says five quotation marks as if exhaustive, and two places still say kept-four (the headerDisplayName doc and the fullwidth-parentheses test title) although the kept set has nine members.
Fix: add \u2E42 to KEPT_CHARACTER_CLASS with a row in both kept-quote it.each blocks (headerDisplayName and neutralizeHeaderMarkers). Reword the doc to name the six kept quotes and say the two ornament dingbats are stripped on purpose, and rename kept-four to kept-ASCII.
Acceptance: U+2E42 survives both sanitizers and is pinned by tests; a canary dropping it reddens both rows; no doc line implies the kept list is exhaustive when it is not.
<!-- SECTION:DESCRIPTION:END -->
