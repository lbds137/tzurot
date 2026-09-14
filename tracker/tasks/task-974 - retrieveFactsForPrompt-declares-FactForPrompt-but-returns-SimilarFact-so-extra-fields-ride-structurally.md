---
id: TASK-974
title: >-
  retrieveFactsForPrompt declares FactForPrompt but returns SimilarFact, so
  extra fields ride structurally
status: To Do
assignee: []
created_date: '2026-09-14 01:32'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 970000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised by claude-review on PR #2419 final round, informational, and the reviewer scoped it as pre-existing. Merits disposition, not an origin one: the declared return type does not describe what the function returns, and that is a latent trap regardless of when it started. services/ai-worker/src/services/factRetrievalHelper.ts declares retrieveFactsForPrompt as Promise<FactForPrompt[]> while returning the SimilarFact[] that FactRetriever produced. TypeScript structural typing accepts the wider object, so entityTags, similarity, isLocked, tier and now reserved all reach callers without appearing in the declared type. PR #2419 relies on exactly that: the log line filters on f.reserved === true and compiles even though FactForPrompt has no reserved field.
Why it is a trap rather than a style point: a reader who opens FactForPrompt to learn what the prompt path can use will not find the fields that are actually there, and a future maintainer who ADDS a field to FactForPrompt has no compile-time signal that the producer must be changed to populate it. The type currently documents a subset and is silently wrong about the rest.
Fix shape: decide which is the real contract. Either widen the declared return type to SimilarFact[] (one-line, honest, couples the helper to the store type), or keep FactForPrompt as a deliberate narrowing and map to it explicitly at the return so the extra fields are dropped rather than leaked — in which case the reserved count must be computed BEFORE the map, since the filter depends on a field the narrowing would remove. Read the callers before choosing; the narrowing is only worth keeping if something downstream depends on the smaller shape.
Acceptance: the declared return type matches what the function returns, either by widening or by an explicit map; if the map is chosen, the reserved-count log line still reports correctly and a test pins it.
<!-- SECTION:DESCRIPTION:END -->
