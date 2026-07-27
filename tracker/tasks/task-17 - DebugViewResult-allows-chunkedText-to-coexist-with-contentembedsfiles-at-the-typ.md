---
id: TASK-17
title: 'DebugViewResult allows chunkedText to coexist with content/embeds/files at the type level…'
status: To Do
assignee: []
created_date: '2026-07-11 00:00'
labels: []
dependencies: []
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-11 — `DebugViewResult` allows `chunkedText` to coexist with `content`/`embeds`/`files` at the type level while `renderViewResult` silently prefers `chunkedText` — a discriminated union would make the exclusivity compiler-enforced. (The sibling `embeds: []` nit shipped with the rendering-hardening PR.) Converting ripples through every view builder + test, so it waits for a natural rewrite. **Promote when**: adding an /inspect view or reworking DebugViewResult. Surfaced by #1588 round-6 review.

**Why:** Latent trap for the NEXT contributor; harmless in current call graphs.
<!-- SECTION:DESCRIPTION:END -->
