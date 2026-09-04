---
id: TASK-230
title: Voice reference export (round-trip symmetry with voice-at-import)
status: To Do
assignee: []
created_date: '2026-07-07 00:00'
updated_date: '2026-09-04 20:06'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 230000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Voice reference export (round-trip symmetry with voice-at-import) — Export emits no voice file; import accepts one. Design GROUNDED during the definition-privacy epic: the existing `/voice-references/:slug` route is deliberately service-auth-gated (anti-enumeration) and bot-client's serviceFetch contract forbids non-infrastructure use — so the correct shape is a NEW owner-gated user route (`GET /user/personality/:slug/voice-reference`, requireUserAuth + canEdit) returning `{ voiceReferenceData: dataUri, voiceReferenceType }` via the typed client (mirrors how import uploads it), then export decodes to a file attachment like the avatar. Needs: route + manifest entry + client regen + export wiring + tests. **Promote when**: next character-command session, or user asks for voice round-trip. Filed 2026-07-07 (epic PR3 scope split, pre-authorized by the plan).

**Why:** Voice survives export → re-import like avatar does.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:06
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-94 (Idea Voice and TTS provider follow ups); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-230 finds it.
---
<!-- COMMENTS:END -->
