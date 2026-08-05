---
id: TASK-431
title: Read the Opus 5 prompting guide and apply to our Claude-facing prompts
status: Done
assignee: []
created_date: '2026-08-04 17:05'
updated_date: '2026-08-05 11:42'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RESOLVED 2026-08-05, both halves shipped. Research pass assessed all four Claude-facing prompt surfaces against the Opus 5 guide. (1) opus-implementer.md: no-subagent bullet added, PR #1971 (develop). (2) claude-code-review.yml feature prompt: report-everything + summary-must-enumerate-all-body-findings clause, PR #1972 (main-cut per the workflow-file procedure; release:finalize run, develop SHA-aligned). Release-review prompt and claude.yml assessed fine-as-is (recorded in the PR bodies). Follow-ups filed: TASK-438 (tools-allowlist experiment). Owner decision left open in #1972 body: whether to pin the review model (spend call; unpinned = drifts with the action default).
<!-- SECTION:NOTES:END -->
