---
id: TASK-105
title: Audit api-gateway key validators for 5xx-as-transient classification
status: Done
assignee: []
created_date: '2026-05-17 00:00'
updated_date: '2026-07-28 20:25'
labels:
  - 'area:api-gateway'
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Audit api-gateway key validators for 5xx-as-transient classification

**Why:** The deleted ai-worker `KeyValidationService` had `ProviderUnavailableError` to distinguish 5xx from 401; current gateway validators (4 providers — elevenlabs/mistral/openrouter/zaiCoding) may not all share this. No current bug — validators run on user-submit and a transient 5xx producing "key invalid" is recoverable. **Promote when**: runtime key-health reporting gets wired up (then mis-classification corrupts the health signal). **Start**: `services/api-gateway/src/utils/apiKeyValidation/types.ts` + each provider file. Surfaced 2026-05-17 by PR #1044 review. Deferred 2026-05-19.
<!-- SECTION:DESCRIPTION:END -->
