---
id: TASK-929
title: >-
  ai-worker is unloadable under tsx: conversationUtils re-exports three
  interfaces without the type keyword
status: Done
assignee: []
created_date: '2026-09-09 22:34'
updated_date: '2026-09-12 12:48'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 927000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: conversationUtils.ts re-exports three names that are all `interface` declarations, without the `type` keyword:

    export {
      StructuredHistoryEntry,
      InlineImageDescription,
      ResponderIdentity,
    } from ./conversationTypes.js;

tsc erases type-only re-exports, so `pnpm typecheck` and `typecheck:spec` both pass, and vitest resolves it too. tsx transpiles per file and cannot know the names are types, so it emits a runtime value re-export of bindings that do not exist. Any tsx entry point whose import graph reaches this module dies with `SyntaxError: ... does not provide an export named InlineImageDescription`.

Cost: no CI tier gates on it, so nothing is broken in the pipeline — but it silently removes `npx tsx` as a diagnostic instrument for the whole ai-worker package. Found 2026-09-09 by the TASK-924 dispatch, which had to route a one-off probe of stripRealMessageEchoArtifacts through vitest instead. The TASK-924 task description itself claims the bug was probed with npx tsx, which cannot have gone through this module.

Fix shape: two consumers exist and both already import type-only — RAGUtils.ts:23 (`import type { InlineImageDescription }`) and ContextWindowManager.test.ts:13 (`import type { StructuredHistoryEntry }`). So the minimal fix is `export type { ... }` on the re-export. Consider instead deleting the re-export and pointing both consumers at conversationTypes.js directly: the block is commented `Re-export from extracted modules for backward compatibility`, and the project rule is that there is no backward compatibility to keep, so a wrapper re-export is the shape 02-code-standards tells us not to have. ResponderIdentity has no consumer through this path at all.

Acceptance: `npx tsx` can load a module whose import graph reaches conversationUtils — pin it with a probe that imports the package entry and exits 0, or state in the PR why no automated tier can hold this; typecheck, typecheck:spec and the ai-worker suite stay green; if the re-export is deleted rather than typed, both consumers import from conversationTypes.js and knip reports no new unused export.
<!-- SECTION:DESCRIPTION:END -->
