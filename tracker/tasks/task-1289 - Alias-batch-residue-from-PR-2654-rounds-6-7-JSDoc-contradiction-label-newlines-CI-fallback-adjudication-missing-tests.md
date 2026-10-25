---
id: TASK-1289
title: >-
  Alias batch residue from PR 2654 rounds 6-7: JSDoc contradiction, label
  newlines, CI-fallback adjudication, missing tests
status: To Do
assignee: []
created_date: '2026-10-25 18:23'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1275000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Merge-as-is residue at the review cap (7 cycles, all no-blocking). Items: (1) resolveAliasBatchItems JSDoc self-contradicts - first sentence says boundary keys always fail closed, code resolves on a unique match; rewrite as the three-way rule (unique resolve / multi-match fail / miss fail) and name SELECT_ALIAS_KEY_LENGTH instead of 92; also make the formatAliasSelectValue + resolveAliasBatchItems collision JSDocs single-canonical with a pointer. (2) Label newline consistency: formatAliasSelectOption and the readSelectOptionLabels listing lack stripNewlines so a newline alias splits a confirm bullet; fallbackAliasLabel and formatDisplayLabel already strip. (3) Adjudicate the case-insensitive fallback in resolveFromFetchedRows: can a case-only mismatch occur legitimately when the bot-authored footer round-trips byte-for-byte (Bob picked, removed, bob re-added)? If not, drop it or require a unique ci candidate like the boundary path. (4) resolveBoundaryKey double-scan control flow: let it decide a zero-match boundary key itself. (5) Tests: missing-option-label path in handleAliasBatchPick (fallbackAliasLabel + formatFallbackIdLabel), invalid-scope footer id at confirm (resolution failure, no removal), case-insensitive-only boundary match branch. (6) Comment the type-narrowing throw in the runBatchSequentially callback; reword the double-ack guard comment (siblings unguarded is fine, no router pre-acks).
<!-- SECTION:DESCRIPTION:END -->
