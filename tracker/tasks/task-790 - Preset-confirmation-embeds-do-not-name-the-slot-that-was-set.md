---
id: TASK-790
title: Preset confirmation embeds do not name the slot that was set
status: Done
assignee: []
created_date: '2026-08-28 03:47'
updated_date: '2026-08-30 11:16'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 790000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner request 2026-08-28 (prod, right after the beta.209 preset flips): /preset global free-default takes a slot option (text | vision — free-default.ts:18, defaulting to DEFAULT_MODEL_SLOT) but the confirmation embed says only "X is now the free tier default preset" with no slot named (free-default.ts:23-25). The owner ran the command twice back-to-back and could not tell from the identical embeds which slot each run had set; a read-only DB query was needed to confirm. Same gap in the sibling /preset global default handler (default.ts:20,24-25).

Fix shape: include the resolved slot in the embed title or description of every preset-set confirmation whose handler takes a slot option — e.g. "X is now the free tier default TEXT preset" / "... VISION preset". Sweep the whole preset command family for slot-taking handlers (grep toModelSlot under bot-client/src/commands/preset/), not just the two cited. Component snapshots updated where they pin the strings.

Acceptance: running a preset-set command with slot:text and slot:vision produces visibly different confirmations, each naming its slot; the default-slot (option omitted) case names the slot it defaulted to.
<!-- SECTION:DESCRIPTION:END -->
