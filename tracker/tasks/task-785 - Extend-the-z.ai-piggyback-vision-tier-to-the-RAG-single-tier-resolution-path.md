---
id: TASK-785
title: Extend the z.ai piggyback vision tier to the RAG single-tier resolution path
status: To Do
assignee: []
created_date: '2026-08-27 15:44'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 785000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review on PR #2237 traced the RAG-family vision call sites (history enrichment, current-message inline fallback, referenced-message attachments — enumerated in ragVisionAuth.ts module doc) to ONE upfront resolveRagVisionAuth -> resolveVisionConfig call (ConversationalRAGService.ts:~144), a single primary-tier resolution that never invokes composeWalkTiers — so the guest piggyback vision tier shipped in #2237 cannot fire there. selectVisionModel free-forces guests away from the piggyback id at every priority, so the admission branch is unreachable from that path by construction.

Fix shape: either route the RAG vision calls through the fallback walk (describeImageWithFallback) so the prepend applies, or add the piggyback consult to the single-tier resolveVisionConfig guest arm with the same requestId anchor. Related: TASK-35 (wire the vision fallback loop into RAG-family paths) — this may be the same unit; check before starting.

Acceptance: a guest RAG-path vision call with an admitted request describes via the piggyback model; denial degrades to the free floor; seam test pins the crossing.
<!-- SECTION:DESCRIPTION:END -->
