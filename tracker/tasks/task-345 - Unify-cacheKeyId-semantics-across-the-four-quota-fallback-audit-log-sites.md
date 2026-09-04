---
id: TASK-345
title: Unify cacheKeyId semantics across the four quota-fallback audit-log sites
status: To Do
assignee: []
created_date: '2026-07-28 21:59'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 345000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the audit lines disagree on what cacheKeyId means (surfaced by the #1840 review). After #1840, two sites log the identity that SERVED the rescue (runner hop-2, auto-promotion fallback) while two log the PRE-swap failing identity (runner hop-1 reactive audit at quotaFallbackRunner.ts ~:172, AuthStep proactive audit). Each value is individually truthful, but log forensics ("why did I get this model") cannot rely on one vocabulary.

Fix shape: a small design call, then a mechanical sweep — either standardize on the serving identity, or extend logQuotaFallbackAudit to carry both (failingCacheKeyId + servingCacheKeyId). Enumerate all four logQuotaFallbackAudit call sites; log-shape change counts as a contract change (semantic-shape per the review-response whitelist), so it gets its own small PR, not a ride-along.

Acceptance: all four audit sites agree on the field vocabulary; the JSDoc on logQuotaFallbackAudit states which identity the field carries.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. real cost (log forensics can't rely on one vocabulary). All four `logQuotaFallbackAudit` call sites still exist and the JSDoc on the function still doesn't state which identity `cacheKeyId` carries. Evidence: `git grep -n logQuotaFallbackAudit services/ai-worker/src` → 4 call sites (`AuthStep.ts:311`, `autoPromotionFallback.ts:210`, `quotaFallbackRunner.ts:205,587`); read `quotaFallback.ts:457-472` → JSDoc still just "one structured audit line per fire," no vocabulary note.
---
<!-- COMMENTS:END -->
