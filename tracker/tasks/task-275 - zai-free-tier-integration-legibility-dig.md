---
id: TASK-275
title: z.ai free-tier integration legibility dig
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:ai-worker'
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 275000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

z.ai free-tier integration legibility dig — Owner-flagged 2026-07-15 after an adversarial code-reading agent concluded the z.ai free tier doesn't exist: `ApiKeyResolver.getSystemApiKey(ZaiCoding)` returns null with "No system fallback for z.ai — every user must bring their own coding-plan key," while `ZaiFreeTierAdmission` (a parallel gate upstream, wired via `guestModeOverrides`) routes admitted guests onto the system `ZAI_CODING_API_KEY` anyway. Runtime behavior is believed correct (admission → GLM-4.5-Air, denial → silent OpenRouter degrade), but the two mechanisms don't reference each other and the resolver's comment reads as authoritative denial. **Dig shape**: trace the guest-request key-resolution end-to-end; either unify the free-tier path into the resolver's model or cross-document the seam (resolver comment names the admission gate; admission gate names why it bypasses the resolver); check for real seam bugs while there (e.g. does any path consult the resolver first and wrongly conclude guest-z.ai is impossible?). **Promote when**: next free-tier/provider-routing touch, or the BYOK-first extraction billing boulder (same subsystem). Surfaced 2026-07-15 (legal-doc verification pass).

**Why:** A feature a careful reader can't find is a feature the next refactor breaks.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. The resolver's `getSystemApiKey(ZaiCoding)` comment still reads as an unqualified denial ("No system fallback for z.ai Coding Plan — every user must bring their own... Callers wanting OpenRouter fallthrough... see ProviderRouter.resolveRoute") with NO cross-reference to `ZaiFreeTierAdmission`, which bypasses this resolver entirely for admitted guests. The two mechanisms still don't reference each other — the dig/cross-documentation hasn't happened. Evidence: `sed -n '319,336p' services/ai-worker/src/services/ApiKeyResolver.ts` → comment names only `ProviderRouter.resolveRoute`, never `ZaiFreeTierAdmission` or `guestModeOverrides`.
---
<!-- COMMENTS:END -->
