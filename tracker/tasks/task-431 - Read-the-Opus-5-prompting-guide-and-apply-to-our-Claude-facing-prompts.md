---
id: TASK-431
title: Read the Opus 5 prompting guide and apply to our Claude-facing prompts
status: To Do
assignee: []
created_date: '2026-08-04 17:05'
labels:
  - 'area:docs'
  - 'size:S'
dependencies: []
priority: low
ordinal: 431000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner side-quest (resurfaced on their radar; no prior tracker entry — verified by search). Anthropic published model-specific prompting guidance for Claude Opus 5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5
Fix shape: read the guide, then sweep the surfaces where WE author prompts that run on Claude models — .github/workflows/claude-code-review.yml (feature + release review prompts), .github/workflows/claude.yml, and the .claude/agents/ definitions (opus-implementer et al.) — and apply whatever guidance materially improves them. Persona prompts are out of scope (they run on GLM/Kimi/OpenRouter models, not Claude).
Acceptance: each surface either updated or explicitly assessed as fine as-is, noted in the PR/commit.
<!-- SECTION:DESCRIPTION:END -->
