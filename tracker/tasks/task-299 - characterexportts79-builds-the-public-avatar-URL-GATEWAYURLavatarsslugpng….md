---
id: TASK-299
title: character/export.ts hand-builds the public avatar URL
status: To Do
assignee: []
created_date: '2026-07-19 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:bot-client'
  - 'area:common-types'
  - 'origin:review'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 299000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-19 (#1726 review nit) — `character/export.ts:79` builds the public avatar URL (`${GATEWAY_URL}/avatars/${slug}.png`) WITHOUT `encodeURIComponent` on the slug, unlike the V2 pilot's `viewV2.viewAvatarUrl` which encodes. Not exploitable (`SLUG_PATTERN` constrains slugs server-side) but inconsistent defense-in-depth, and 00-critical's SSRF rule says encode ALL dynamic path segments regardless of source trust. ~~**Fix shape**: wrap the slug in `encodeURIComponent`~~ ✅ DONE (both live sites: `character/export.ts` + identity's `deriveAvatarUrl`). REMAINING: extract a shared avatar-URL helper so the sites can't drift — deferred because the two shapes differ (internal URL + no cache-buster vs public URL + timestamp) AND live in different packages (bot-client vs identity), so sharing means a common-types move, not a local extraction. Note the row's "third site" is stale: `viewV2.viewAvatarUrl` no longer builds a URL, it returns `character.avatarUrl`. THIRD site (beta.172 release review): identity's `deriveAvatarUrl` itself concatenates the slug unencoded — the canonical deriver has the same gap, mitigated only by creation-time slug validation. The shared-helper fix covers all three. **Promote when**: next avatar-URL touch, or if slug validation ever loosens.

**Why:** One-line alignment; the shared-helper variant kills the drift class.
<!-- SECTION:DESCRIPTION:END -->
