---
id: TASK-1215
title: >-
  Surface inventory: resolve conditional spreads (...(cond && { k })) to their
  keys instead of *
status: Done
assignee: []
created_date: '2026-10-11 22:23'
updated_date: '2026-10-12 00:11'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1204000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after the direct-argument spread fix (TASK-1169), a conditional spread such as `...(files !== undefined && { files })` reads as the unknown marker `*`, because returnedLiteralKeys in packages/tooling/src/surface/analyzer.ts resolves only identifier spreads. Measured at the fix: 2 of the 5 newly marked bot-client surface sites are this shape (services/DiscordResponseSender.ts and utils/ownerChannel.ts), so the inventory hides a real discord.js key (files) behind the marker.

What: in returnedLiteralKeys, unwrap parentheses and read a `&&` binary expression whose right operand is an object literal (and a conditional expression with literal branches) as that literal keys; everything else keeps the marker. Regenerate the snapshot.

Acceptance: a fixture `...(x && { k })` records k with no marker; a non-literal right operand still records the marker; the two bot-client sites list files instead of `*`.
<!-- SECTION:DESCRIPTION:END -->
