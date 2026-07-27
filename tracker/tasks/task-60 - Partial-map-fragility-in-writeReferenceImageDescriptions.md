---
id: TASK-60
title: 'Partial-map fragility in writeReferenceImageDescriptions'
status: To Do
assignee: []
created_date: '2026-06-17 00:00'
labels: []
dependencies: []
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Partial-map fragility in `writeReferenceImageDescriptions`

**Why:** `writeReferenceImageDescriptions` replaces (not merges) a stored reference's `resolvedImageDescriptions` from a single `descriptionsByUrl` map. Safe today because `referenceAttachments` is assembled in one preprocessing pass covering all of a message's reference images, so the map is always complete (documented at the call site with an "intentional replace, not merge" comment). **Promote when**: a second/retry persist path is introduced that passes a _partial_ map (only some of a message's reference images) — the replace would then silently drop previously-persisted descriptions; switch to merge-by-filename or assert completeness. **Also watch**: the `logger.warn` on "no user message found" could be noisy if a job-dispatch→message-persistence timing gap exists in prod; downgrade to `debug` if observed post-deploy. Surfaced by PR #1241 claude-review. Deferred 2026-06-17.
<!-- SECTION:DESCRIPTION:END -->
