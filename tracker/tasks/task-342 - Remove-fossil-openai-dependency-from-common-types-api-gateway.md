---
id: TASK-342
title: Remove fossil openai dependency from common-types + api-gateway
status: Done
assignee: []
created_date: '2026-07-28 16:50'
updated_date: '2026-07-28 22:20'
labels:
  - 'size:S'
dependencies: []
priority: medium
ordinal: 342000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: `openai` is declared in packages/common-types/package.json and services/api-gateway/package.json but has ZERO imports in src AND dist of both (verified by grep 2026-07-28). It was added by 65f6047c7 for the QdrantMemoryService-era service layer, which no longer exists (pgvector replaced Qdrant). Two knip.json ignoreDependencies entries suppress unused-dep detection for it — those are equally stale.

Fix shape: remove the dep from both package.json files, drop the two knip ignore entries, pnpm install, verify docker-build-smoke passes. CAVEAT (verify-the-keep-list): the original commit fixed a Railway build failure — before trusting removal, confirm no transitive runtime require resolves through these declarations under pnpm isolated node_modules (the @langchain/openai stack lives in ai-worker, not these packages).
<!-- SECTION:DESCRIPTION:END -->
