---
id: TASK-625
title: 'release:premigrate destructive-shape detector matches SQL comments'
status: To Do
assignee: []
created_date: '2026-08-16 01:11'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 625000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the beta.202 premigrate refused the collapse_reasoning_to_thinking migration as destructive (RENAME COLUMN, ALTER COLUMN TYPE) - but the migration is pure DML (two UPDATEs on llm_configs.advanced_parameters). The matched strings live in the migration file header COMMENT, which happens to describe the detector itself. The detector greps raw SQL text without stripping comments, so any migration whose comments mention destructive shapes false-positives and forces --allow-destructive.

Fix shape: strip line (--) and block comments before shape-matching in the premigrate destructive detector (packages/tooling, release:premigrate implementation). Pin with a test: a pure-DML migration whose comments name every destructive keyword must pass without --allow-destructive; a real RENAME COLUMN must still refuse.

Acceptance: the beta.202 collapse migration file, as committed, classifies as non-destructive.
<!-- SECTION:DESCRIPTION:END -->
