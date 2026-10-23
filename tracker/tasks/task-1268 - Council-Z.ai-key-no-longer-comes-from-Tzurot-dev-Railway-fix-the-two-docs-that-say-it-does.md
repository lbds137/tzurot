---
id: TASK-1268
title: >-
  Council Z.ai key no longer comes from Tzurot dev Railway: fix the two docs
  that say it does
status: To Do
assignee: []
created_date: '2026-10-23 15:32'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1256000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after the Railway breach rotation (2026-10-23) council has its own Z.ai Coding Plan key (Lila ruling), stored with council scripts/set-secret.sh ZAI_CODING_API_KEY. Two docs still tell a session to copy the key from Tzurot dev ai-worker: council-mcp-server CLAUDE.md:250, and .claude/rules/05-tooling.md (Model calls from tooling: pull ZAI_CODING_API_KEY via railway variables --environment development --service ai-worker). Following either would overwrite council's own key with Tzurot's.

What: council CLAUDE.md: replace the railway pipe with the hidden-prompt form (scripts/set-secret.sh ZAI_CODING_API_KEY) and say the key is council's own. 05-tooling (PR, rules are review-gated): decide whether tooling/eval runs keep using Tzurot dev's key (fine, it is the dev key) and drop any implication that council shares it.

Acceptance: grep for 'service ai-worker --json | jq' in both repos returns only intended uses.
<!-- SECTION:DESCRIPTION:END -->
