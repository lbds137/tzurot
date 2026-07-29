---
id: TASK-208
title: >-
  Shapes import: verify multi-user shared-memory splitting is handled by the
  pipeline
status: Done
assignee: []
created_date: '2026-07-05 00:00'
updated_date: '2026-07-29 16:31'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 208000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Shapes import: verify multi-user shared-memory splitting is handled by the pipeline

**Why:** Pre-pipeline manual scripts split shared memories into per-user copies and mapped shapes UUIDs. ShapesPersonaMapping + import pipeline have since shipped — VERIFY the multi-user-memory split case is covered (grep ShapesImportMemories for multi-user handling); file a real gap if not. Ingested 2026-07-05.

**VERIFIED 2026-07-29 (code-read, the verification the task asked for) — handled by design, no gap:**
1. Per-importer isolation replaces the manual split: ShapesImportJob resolves the personality via normalizeSlugForUser (user-suffixed slug for non-owners), so EACH importer creates their own personality row, and importMemories’ content-dedup set is scoped to that fresh personalityId — a second user importing the same character gets full copies (their shared memories are NOT deduped away against the first importer’s rows).
2. Within one import, all memories (multi-sender included) land under the importer’s default persona — the correct ownership model (the import IS that user’s copy of the character); senders[] and legacyShapesUserId (first-sender UUID) are preserved as metadata.
3. The manual scripts’ UUID→user mapping is now ShapesPersonaMapping + BatchResolvers, resolving sender shapes-UUIDs to persona identity at reference/render time.
Retrieval is persona-scoped (MemoryRetriever), so no cross-user leakage from the single-persona stamping.
<!-- SECTION:DESCRIPTION:END -->
