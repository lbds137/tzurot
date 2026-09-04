---
id: TASK-825
title: >-
  Redis entry-size caps measure UTF-16 code units, not bytes, in both
  persistence stores
status: To Do
assignee: []
created_date: '2026-08-29 19:17'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 825000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised by claude-review on PR 2253 (TASK-821), accepted as a follow-up rather than fixed there. Both bot-client persistence stores guard against an oversized Redis value before parsing it, and both test `raw.length` — which counts UTF-16 code units, not bytes. For content with multi-byte characters (emoji, Hebrew, any non-Latin text — all routine in this project) the real serialized size can exceed the documented 64 KB cap before the guard trips. The persisted payloads include user message content, so multi-byte input is the normal case, not an edge one.

Sites (verify before editing, cites drift): SingleJobPersistence.ts MAX_ENTRY_BYTES and its parse guard; MultiTagPersistence.ts MAX_ENTRY_BYTES and its parse guard. The single-job one is new in 2253 and was written to mirror the multi-tag sibling, so the imprecision was inherited deliberately rather than introduced — fixing only one would create a divergence between two files 2253 worked to keep aligned, which is exactly why it was NOT fixed there.

Severity is genuinely low: the cap is a soft defensive heuristic against a malformed value dominating the boot scan, not a correctness or security boundary. A too-generous cap admits a larger-than-intended entry; it does not corrupt anything. PR 2253 corrected the COMMENT so the prose no longer overstates what is measured — this task is the behaviour half.

Fix shape: swap both guards to Buffer.byteLength(raw, "utf8") and keep the constant name honest. Check whether any test pins the current code-unit behaviour before changing it. Do both sites in one diff so they cannot drift.

Acceptance: both stores trip their cap on actual serialized byte size; the two implementations remain identical to each other; the constants and comments say bytes and mean bytes.

Provenance: reviewer-raised on PR 2253, deferred there with the divergence reason stated — counts against the drain net.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed both sites still use `raw.length` (UTF-16 code units) against `MAX_ENTRY_BYTES`, exactly as filed. Evidence: `grep -n "MAX_ENTRY_BYTES\|raw.length" services/bot-client/src/services/SingleJobPersistence.ts services/bot-client/src/services/MultiTagPersistence.ts` → both still guard with `raw.length > MAX_ENTRY_BYTES`.
---
<!-- COMMENTS:END -->
