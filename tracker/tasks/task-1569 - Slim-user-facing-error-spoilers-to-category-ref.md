---
id: TASK-1569
title: Slim user-facing error spoilers to category + ref
status: Done
assignee:
  - tzurot-A
created_date: '2026-11-27T05:47:00Z'
updated_date: '2026-11-27T09:59:00Z'
labels:
  - area:common-types
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1559000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila ruling 11-27 (~00:45 via Deck): user-facing error spoilers show error category + reference id ONLY — no provider text, URLs, or credit amounts. Full technicalMessage stays in the logs (GenerationStep err JSON already logs it). Same ruling recorded: no OpenRouter top-up (free users get side-effect freebies only), no fallback max_tokens cap.

What: formatErrorSpoiler (packages/common-types/src/constants/error.ts:568) drops the quoted technicalMessage part; the spoiler renders ||*(error: <category>; ref: <id>)*||. Remove the now-unused technicalMessage param through its callers (formatPersonalityErrorMessage in the same file; buildErrorContent.ts:58,72 in bot-client). userActionMessage paths unchanged (approved copy, not provider text).

Acceptance: spoiler assertions in error.test.ts + buildErrorContent.test.ts pin the new shape; no test asserts provider text in a spoiler anymore; typecheck+tests green in common-types and bot-client.
<!-- SECTION:DESCRIPTION:END -->
