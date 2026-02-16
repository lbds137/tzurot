#!/bin/bash
# Forced skill evaluation hook
# Compensates for unreliable skill auto-activation (~20% success rate)
# Uses regex matching for instant (<5ms) evaluation - no LLM overhead
#
# Only triggers for actual skills (`.claude/skills/` directories).
# Rules (`.claude/rules/`) are always loaded and don't need reminders.

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

# Exit if no prompt or jq not available
if [ -z "$PROMPT" ] || ! command -v jq &> /dev/null; then
    exit 0
fi

# Build list of relevant skills based on keywords
RELEVANT_SKILLS=""

# Database/Prisma → tzurot-db-vector skill
if echo "$PROMPT" | grep -qiE 'prisma|schema\.prisma|migration|database|pgvector|findMany|findFirst|createMany'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-db-vector"
fi

# Testing → tzurot-testing skill
if echo "$PROMPT" | grep -qiE '\.test\.ts|vitest|mock|coverage|beforeEach|afterEach|describe\(|it\(|expect\(|fake.?timer'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-testing"
fi

# Deployment → tzurot-deployment skill
if echo "$PROMPT" | grep -qiE 'railway|deploy|production|staging|live.?issue|logs.*service'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-deployment"
fi

# Git → tzurot-git-workflow skill
if echo "$PROMPT" | grep -qiE 'git commit|git push|pull.?request|\bPR\b|rebase|merge.*branch|create.*commit'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-git-workflow"
fi

# Documentation session workflow → tzurot-docs skill
if echo "$PROMPT" | grep -qiE 'CURRENT\.md|BACKLOG\.md|wrap.?up|session.?end|summarize|done.?for.?now'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-docs"
fi

# Documentation Audit → tzurot-doc-audit skill
if echo "$PROMPT" | grep -qiE 'doc.*audit|audit.*doc|documentation.*fresh|stale.*doc|review.*doc'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-doc-audit"
fi

# MCP Council → tzurot-council-mcp skill
if echo "$PROMPT" | grep -qiE 'mcp|council|second.?opinion|stuck|brainstorm'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-council-mcp"
fi

# Architecture Audit → tzurot-arch-audit skill
if echo "$PROMPT" | grep -qiE 'arch.*audit|audit.*arch|boundary.*check|depcruise.*audit'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-arch-audit"
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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
fi
