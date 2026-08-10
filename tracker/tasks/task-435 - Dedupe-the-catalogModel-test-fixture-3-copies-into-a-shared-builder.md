---
id: TASK-435
title: Dedupe the catalogModel() test fixture (3 copies) into a shared builder
status: Done
assignee: []
created_date: '2026-08-05 04:45'
updated_date: '2026-08-10 12:05'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 435000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the same CatalogModel fixture builder is hand-duplicated across models/autocomplete.test.ts, preset/autocomplete.test.ts, and utils/modelCatalogAutocomplete.test.ts, with small type-safety drift between copies (one uses an "as CatalogModel" cast). Reviewer-judged acceptable at 3 copies; CPD filtered metric does not flag test code.

Promote when: a 4th copy of the fixture appears, or any of the three drifts behaviorally.

Fix shape: one shared test-only builder - either packages/test-factories (if CatalogModel is importable there without a dependency knot) or a colocated test-util in bot-client. Replace all copies; kill the cast.

Acceptance: one builder, three (or more) consumers, no "as CatalogModel" cast.
<!-- SECTION:DESCRIPTION:END -->
