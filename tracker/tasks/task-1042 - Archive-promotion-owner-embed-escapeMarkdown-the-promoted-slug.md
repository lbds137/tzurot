---
id: TASK-1042
title: 'Archive-promotion owner embed: escapeMarkdown the promoted slug'
status: To Do
assignee: []
created_date: '2026-09-22 13:49'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1036000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: ArchivePromotionScheduler.buildPromotionEmbed (services/bot-client/src/services/ArchivePromotionScheduler.ts) passes promotion.slug into cappedInlineField, which clamps length but never escapes markdown; MemoryArchivePromotionSchema.slug is deliberately looser than SLUG_PATTERN so a legacy row could render broken markdown in the owner embed. Review round 6 on #2470, merged at the six-round cap with this as fix-forward (owner ruling 2026-09-22). Owner-only channel, gateway-validated slugs in the normal path: cosmetic.
Fix shape: wrap the slug in escapeMarkdown() at the embed build site; one scheduler test with a slug carrying an underscore or asterisk asserting the escaped form reaches the field.
Acceptance: the test above green; no other embed field changes.
<!-- SECTION:DESCRIPTION:END -->
