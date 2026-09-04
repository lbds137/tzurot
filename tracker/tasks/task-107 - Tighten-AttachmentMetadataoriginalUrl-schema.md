---
id: TASK-107
title: Tighten AttachmentMetadata.originalUrl schema
status: To Do
assignee: []
created_date: '2026-05-18 00:00'
updated_date: '2026-09-04 19:35'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Tighten `AttachmentMetadata.originalUrl` schema

**Why:** After PR #1050, `extractAttachments` always sets `originalUrl: attachment.url`, but the schema keeps it `z.string().optional()` because other paths (`services/ai-worker/src/jobs/handlers/pipeline/steps/DependencyStep.ts:420,442`) construct attachments without it. The reader's defensive `if (originalUrl === undefined) return null` guard in `AudioProcessor.lookupCachedTranscript` is load-bearing because of this. **Fix shape**: either (a) require `originalUrl` at the schema level + update the few callers to default to `attachment.url`, or (b) split into `BotClientAttachment` (requires originalUrl) vs `WorkerInternalAttachment` types. Option (a) is simpler. **Promote when**: doing a multimodal attachment-handling refactor or when the defensive guard becomes load-bearing in a new code path. Surfaced 2026-05-18 by PR #1050 reviewer. Deferred 2026-05-19.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:35
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `originalUrl` is still `z.string().optional()` in the schema, and `DependencyStep.ts`'s `buildPreprocessingResults` still constructs `ProcessedAttachment.metadata` objects (for both image and audio branches) without an `originalUrl` field — confirming the schema can't yet be tightened without touching that caller. Task is `state:ready`, no blocker beyond deciding to do the work. Evidence: `git grep -n "originalUrl" packages/common-types/src/types/schemas/discord.ts` → still `.optional()`; `sed -n '410,450p' services/ai-worker/src/jobs/handlers/pipeline/steps/DependencyStep.ts` → `metadata: { url, name, contentType, size }` with no `originalUrl` key.
---
<!-- COMMENTS:END -->
