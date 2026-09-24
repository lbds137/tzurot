---
id: TASK-1086
title: system-model.md re-touch for the doc-8 memory-archive epic close-out
status: To Do
assignee: []
created_date: '2026-09-24 20:55'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1079000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 06-backlog.md § Promoting a theme to Active Epic step 0 asks what the finished epic changed on the map. doc-8 shipped the memory-archive split render (memories.assistant_summary, the memory_archive section, per-character render switches, the sameChannelRenderMode summarized mode) and doc-97 shipped the voice_anchor V-tier section. The map carries the recent-days digest (line 52 and the row at line 146) but no archive-render or voice-anchor row (grep archive|voice_anchor returns only digest lines, 2026-09-24).
Fix shape: one pass over docs/reference/architecture/system-model.md adding the archive render and the anchor to the prompt-assembly and memory rows, within its ~150-line budget (evict, do not grow).
Acceptance: grep memory_archive and voice_anchor each hit the map; lines:check green.
<!-- SECTION:DESCRIPTION:END -->
