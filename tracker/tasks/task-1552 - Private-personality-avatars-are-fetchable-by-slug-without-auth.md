---
id: TASK-1552
title: Private personality avatars are fetchable by slug without auth
status: To Do
assignee: []
created_date: '2026-11-25T19:17:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:owner
dependencies: []
priority: low
ordinal: 1547000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: public/avatars.ts GET /:filename is mounted with only a rate limiter (index.ts:392), and avatar URLs are fetched anonymously by Discord embeds and the CDN (7-day max-age). So anyone holding a private personality slug can fetch its avatar bytes, and the 404 versus 200 confirms the slug exists. voiceReferences closed the same slug-enumeration shape with service auth, but avatars cannot take user auth because Discord fetches them. Found in the PR #2813 round-3 route classification.

Owner question: should private personality avatars stay publicly fetchable by slug, or move to unguessable or signed URLs?
Recommendation: unguessable per-upload filenames (a random token in the avatar path) — closes enumeration without breaking anonymous Discord/CDN fetches, and needs no signing infrastructure.

Acceptance: a decision recorded here; if changed, a private personality avatar is unreachable from its slug alone.
<!-- SECTION:DESCRIPTION:END -->
