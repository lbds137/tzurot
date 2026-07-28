---
id: doc-45
title: >-
  Idea: Commands import Discord TYPES from common-types — enables a module-level
  depcruise boundary (Phase 3 planning, 2026-07-20)
type: other
created_date: '2026-07-28 11:11'
---

## Commands import Discord TYPES from common-types — enables a module-level depcruise boundary (Phase 3 planning, 2026-07-20)

Phase 3's UX-boundary enforcement is an ESLint builder-symbol rule with a shrink-only per-file×per-symbol allowlist (66 files import builders today), because a module-level depcruise "commands must not import discord.js" rule over-blocks — 147 command files legitimately import discord.js *types* (interaction types, enums). The clean end-state: commands consume Discord types only via `@tzurot/common-types` re-exports (the ai-worker already lives this way), making `commands/**` discord.js-import-free and the boundary a one-line depcruise rule mirroring `ux-catalog-no-discord`. Cost: a large mechanical import sweep across ~147 files + curating the type re-export surface. **Promote when**: the ESLint symbol rule proves leaky in practice, or its allowlist burns down below ~20 files (the refactor's marginal cost drops as adoption rises).

