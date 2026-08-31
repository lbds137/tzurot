---
id: TASK-845
title: >-
  PROVIDER_CONTENT_REFUSED user message assumes an image, but the category now
  reaches text-only turns
status: To Do
assignee: []
created_date: '2026-08-31 20:00'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 845000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced by the orchestrator diff read on the TASK-789 clause-2 PR. That PR adds a z.ai content-safety pattern to ERROR_PATTERNS.PROVIDER_CONTENT_REFUSED, so the category is no longer reachable only from Alibaba vision calls.

The user-facing string for that category (USER_ERROR_MESSAGES in packages/common-types/src/constants/error.ts:266-267, verify before editing, cites drift) reads: "The provider handling that request declined the attached image. Try again — a different provider may accept it."

That wording assumes an image is involved. It is no longer guaranteed: the general generation path never carries raw image bytes because attachments are pre-converted to text descriptions (stated at services/ai-worker/src/services/quotaFallback.ts:131-136). So a z.ai content-safety refusal on a text turn would tell the user their attached image was declined when no image exists in the request.

Owner decision needed, fail-closed per 06-backlog because this is user-visible copy: (a) reword to be payload-neutral, something that works for both an image and a text turn; or (b) leave as-is on the grounds that the refusal is overwhelmingly image-driven in practice and the rare text case is acceptable noise.

Note the second half of the sentence stays true either way — a different provider may indeed accept it — so only the "attached image" clause is at issue.

Acceptance: owner picks (a) or (b); if (a), the new wording is in place and no test pins the old image-specific phrasing.
<!-- SECTION:DESCRIPTION:END -->
