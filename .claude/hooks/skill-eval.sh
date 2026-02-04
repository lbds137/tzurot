#!/bin/bash
# Forced skill evaluation hook
# Compensates for unreliable skill auto-activation (~20% success rate)
# Uses regex matching for instant (<5ms) evaluation - no LLM overhead

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

# Exit if no prompt or jq not available
if [ -z "$PROMPT" ] || ! command -v jq &> /dev/null; then
    exit 0
fi

# Build list of relevant skills based on keywords
RELEVANT_SKILLS=""

# Database/Prisma
if echo "$PROMPT" | grep -qiE 'prisma|schema\.prisma|migration|database|pgvector|findMany|findFirst|createMany'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-db-vector"
fi

# Testing
if echo "$PROMPT" | grep -qiE '\.test\.ts|vitest|mock|coverage|beforeEach|afterEach|describe\(|it\(|expect\(|fake.?timer'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-testing"
fi

# Async/Queue
if echo "$PROMPT" | grep -qiE 'bullmq|queue|job|worker|deferral|retry|idempoten'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-async-flow"
fi

# Deployment
if echo "$PROMPT" | grep -qiE 'railway|deploy|production|staging|live.?issue|logs.*service'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-deployment"
fi

# Discord UX
if echo "$PROMPT" | grep -qiE 'slash.?command|interaction|button|pagination|discord.*ux|ephemeral'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-slash-command-ux"
fi

# Git (use word boundaries to avoid matching "PR" in "prisma")
if echo "$PROMPT" | grep -qiE 'git commit|git push|pull.?request|\bPR\b|rebase|merge.*branch|create.*commit'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-git-workflow"
fi

# Security (CRITICAL - always flag)
if echo "$PROMPT" | grep -qiE 'secret|security|execSync|exec\(|spawn|user.?input|sanitiz|credential|token|api.?key'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-security"
fi

# Types/Schemas
if echo "$PROMPT" | grep -qiE 'zod|schema|type.*interface|common-types|validation|constant'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-types"
fi

# Code Quality
if echo "$PROMPT" | grep -qiE 'eslint|lint|refactor|complexity|extract.*function|500.*lines|100.*lines'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-code-quality"
fi

# Documentation
if echo "$PROMPT" | grep -qiE 'CURRENT\.md|BACKLOG\.md|wrap.?up|session.?end|summarize|done.?for.?now'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-docs"
fi

# MCP Council
if echo "$PROMPT" | grep -qiE 'mcp|council|second.?opinion|stuck|brainstorm'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-council-mcp"
fi

# Architecture
if echo "$PROMPT" | grep -qiE 'architecture|service.?boundary|where.*code.*belong|anti-?pattern'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-architecture"
fi

# Caching
if echo "$PROMPT" | grep -qiE 'cache|ttl|redis|stale|invalidat'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-caching"
fi

# Observability
if echo "$PROMPT" | grep -qiE 'logging|debug|correlation.?id|structured.?log|railway.*log'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-observability"
fi

# Tooling
if echo "$PROMPT" | grep -qiE 'pnpm ops|cli|script|tooling'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-tooling"
fi

# Trim whitespace
RELEVANT_SKILLS=$(echo "$RELEVANT_SKILLS" | xargs)

# Only output if we found relevant skills
if [ -n "$RELEVANT_SKILLS" ]; then
cat << EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SKILL CHECK: Keywords detected for: $RELEVANT_SKILLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Load these skills NOW using Skill("skill-name") BEFORE implementation.
See .claude/rules/00-skill-routing.md for the full routing table.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
fi
