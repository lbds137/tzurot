---
id: TASK-347
title: Validate gateway base URLs have no trailing slash at env parse
status: To Do
assignee: []
created_date: '2026-07-28 22:58'
updated_date: '2026-07-28 22:58'
labels:
  - 'area:common-types'
  - 'size:S'
dependencies: []
priority: low
ordinal: 347000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: every URL composition site in the codebase (dozens of ${GATEWAY_URL}/api/... templates, plus PUBLIC_GATEWAY_URL in identity's deriveAvatarUrl and the avatarUrlPath consumers) assumes the base carries no trailing slash — a trailing-slash config value would mint //-doubled paths at every one of them. Surfaced as a non-blocking flag on the #1843 review; the per-site fix is the wrong layer (single-site hardening of a global config contract).

Fix shape: tighten the contract at the source — the Zod env schema in common-types config: .refine(no trailing slash) (or .transform stripping it, pick one and document) on GATEWAY_URL and PUBLIC_GATEWAY_URL, with a startup-fail-fast error naming the offending variable. One schema change + tests; no call-site edits.

Acceptance: a trailing-slash value for either variable fails env validation (or is normalized) with a clear message; existing valid configs unaffected.
<!-- SECTION:DESCRIPTION:END -->
