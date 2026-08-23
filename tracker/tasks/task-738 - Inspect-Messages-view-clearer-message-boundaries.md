---
id: TASK-738
title: 'Inspect Messages view: clearer message boundaries'
status: To Do
assignee: []
created_date: '2026-08-23 03:15'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 738000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner feedback after first real use (beta.206 dev flip, 2026-08-22): "it just looks a bit ugly... would be nice if message boundaries were a bit clearer." The current banner (a plain-text line with box-drawing glyphs and [N/total] role) disappears into the content, especially when history rows themselves carry XML blocks (prior_conversations) or long vision descriptions — a 20k-char first message drowns the separators entirely.

Fix shape (design at build; content stays verbatim, only the FRAMING changes): make banners visually distinct in Discord rendering — candidates: bold markdown banner line, a leading blank line + markdown heading, or -# subtext divider rows; possibly right-size the [N/total] label. Constraint: the view renders via chunkedText (inline ephemeral, splitMessage), so any framing must survive chunk boundaries and not introduce fence pairing (escapeFenceBreaks discipline stays).

Acceptance: the owner can visually scan message boundaries on a phone; content bytes unchanged (banner/framing lines only).
<!-- SECTION:DESCRIPTION:END -->
