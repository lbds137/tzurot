---
id: TASK-208
title: 'Shapes import: verify multi-user shared-memory splitting is handled by the pipeline'
status: To Do
assignee: []
created_date: '2026-07-05 00:00'
labels: []
dependencies: []
ordinal: 208000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Shapes import: verify multi-user shared-memory splitting is handled by the pipeline

**Why:** Pre-pipeline manual scripts split shared memories into per-user copies and mapped shapes UUIDs. ShapesPersonaMapping + import pipeline have since shipped — VERIFY the multi-user-memory split case is covered (grep ShapesImportMemories for multi-user handling); file a real gap if not. Ingested 2026-07-05.
<!-- SECTION:DESCRIPTION:END -->
