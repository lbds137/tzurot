---
id: TASK-275
title: z.ai free-tier integration legibility dig
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:ai-worker'
  - 'area:docs'
  - 'size:S'
dependencies: []
priority: low
ordinal: 275000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

z.ai free-tier integration legibility dig — Owner-flagged 2026-07-15 after an adversarial code-reading agent concluded the z.ai free tier doesn't exist: `ApiKeyResolver.getSystemApiKey(ZaiCoding)` returns null with "No system fallback for z.ai — every user must bring their own coding-plan key," while `ZaiFreeTierAdmission` (a parallel gate upstream, wired via `guestModeOverrides`) routes admitted guests onto the system `ZAI_CODING_API_KEY` anyway. Runtime behavior is believed correct (admission → GLM-4.5-Air, denial → silent OpenRouter degrade), but the two mechanisms don't reference each other and the resolver's comment reads as authoritative denial. **Dig shape**: trace the guest-request key-resolution end-to-end; either unify the free-tier path into the resolver's model or cross-document the seam (resolver comment names the admission gate; admission gate names why it bypasses the resolver); check for real seam bugs while there (e.g. does any path consult the resolver first and wrongly conclude guest-z.ai is impossible?). **Promote when**: next free-tier/provider-routing touch, or the BYOK-first extraction billing boulder (same subsystem). Surfaced 2026-07-15 (legal-doc verification pass).

**Why:** A feature a careful reader can't find is a feature the next refactor breaks.
<!-- SECTION:DESCRIPTION:END -->
