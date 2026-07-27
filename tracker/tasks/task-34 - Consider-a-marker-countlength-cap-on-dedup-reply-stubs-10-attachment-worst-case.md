---
id: TASK-34
title: 'Consider a marker-count/length cap on dedup reply-stubs (10-attachment worst case)'
status: To Do
assignee: []
created_date: '2026-07-01 00:00'
labels:
  - 'origin:review'
dependencies: []
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Consider a marker-count/length cap on dedup reply-stubs (10-attachment worst case)

**Why:** The dedup-stub truncation fix (single truncation point, text-only cap) deliberately preserves ALL attachment filename markers in full — removing the only upper bound on combined stub size. Worst case: a reply-target with Discord's max 10 long-filename attachments produces a "lightweight" stub of ~1000+ chars in `<contextual_references>`/`<quoted_messages>`, a real (if narrow) token-budget change. Documented as intentional by the `preserves all markers in full` test in `referenceEnrichment.test.ts`. **Fix shape**: cap marker COUNT (e.g. first N + `[+K more attachments]`) rather than truncating filenames (they're the correlation hint). Needs its own design + tests. **Promote when**: marker-heavy stubs observed bloating prompts, or next touching the dedup-stub format. Surfaced 2026-07-01 (PR #1431 post-squash review).
<!-- SECTION:DESCRIPTION:END -->
