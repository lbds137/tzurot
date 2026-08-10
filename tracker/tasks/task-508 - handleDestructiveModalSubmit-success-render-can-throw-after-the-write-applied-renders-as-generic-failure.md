---
id: TASK-508
title: >-
  handleDestructiveModalSubmit success render can throw after the write applied
  - renders as generic failure
status: Done
assignee: []
created_date: '2026-08-10 18:00'
updated_date: '2026-08-10 19:53'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 508000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the shared destructive-modal helper (utils/confirmation/confirmDestructive.ts, success branch ~:401-414) awaits interaction.editReply AFTER executeOperation succeeded, with no catch in the helper or any of its four callers (memory/purge.ts:277, settings/data/delete.ts:257, history/index.ts:154, voice/voices/purge.ts:185). A Discord API throw there propagates to CommandHandler generic modal catch, which renders interactionFailed - a definitive-failure framing over an ALREADY-APPLIED purge or account deletion, inviting a redo. Same outcome-honesty class as the batchDelete fix in PR 2050; bigger blast radius (account-data deletion is the highest-stakes caller). Mechanism verified in source; surfaced by the 2050 round-3 review.
Fix shape: apply the 2050 pattern - wrap the success render (or phase-track) inside handleDestructiveModalSubmit so a post-write render throw confirms the applied outcome (destructiveApplied catalog shape) instead of a generic failure; one seam test per outcome arm, mutation-proven.
Acceptance: a success-render throw in each of the four flows renders an applied-outcome message, never a failure/retry framing; tests pin it.

Shipped in PR 2053 (eb3ce8a1a). Residual surface (review round 3, accepted): if BOTH the success render AND the destructiveApplied fallback render throw, the error propagates to CommandHandler generic catch (interactionFailed copy - no retry invitation, but not outcome-honest). No in-band fix exists - a third render rides the same failing channel; the logger.error before the fallback is the durable record.
<!-- SECTION:DESCRIPTION:END -->
