---
id: TASK-147
title: >-
  Purge-confirmation footer rename Personality to Character (cross-deploy
  window)
status: To Do
assignee: []
created_date: '2026-06-16 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: low
ordinal: 147000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`purge` confirmation footer prefix renamed `Personality: `→`Character: ` (cross-deploy display-name blank)

**Why:** `memory/purge.ts` `FOOTER_PREFIX` encodes the character display name in the confirmation embed footer and `readPersonalityNameFromMessage` reads it back via `startsWith(FOOTER_PREFIX)`. A purge confirmation shown _before_ the beta.133 deploy whose button/modal is clicked _after_ the bot-client restart will fail the new `startsWith('Character: ')` check → `readPersonalityNameFromMessage` returns `null` → display name renders blank. **Not a functional regression**: the personalityId lives in the customId, so the purge still targets the right character; only the footer-derived display text is affected, and it self-heals on the next purge. A dual-prefix fallback was explicitly rejected as the backward-compat the project's "No Backward Compatibility" rule forbids. **Promote when**: blank-purge-footer reports actually surface in monitoring (otherwise this one-time deploy-window glitch needs no action). Surfaced 2026-06-16 across all three PR #1232 claude-review rounds (non-blocking; flagged for awareness). Deferred 2026-06-16.
<!-- SECTION:DESCRIPTION:END -->
