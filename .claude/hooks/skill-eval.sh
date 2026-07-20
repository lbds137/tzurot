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

# Bug remediation → tzurot-bug-remediation skill. Two trigger families:
# (a) recurrence language (a "fixed" class came back), and (b) the FIRST-fix
# moment for a path-specific UI/flow bug — the skill's first-fix sibling-sweep
# only helps if the skill loads THEN, not just on recurrence (the phrasing here
# mirrors the owner's smoke-report shape: "delete button doesn't show up after
# creation", "only shows up after edit").
if echo "$PROMPT" | grep -qiE 'keeps? (biting|happening|recurring)|recurring bug|regress(ed|ion)|why didn.t.*tests? catch|root.?cause|(delete|edit|create|browse|view|save|submit) (button|flow|screen|dialog|modal)|does(n.?t| not) (show|appear|render)|only (shows?|appears?).*(after|on)'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-bug-remediation"
fi

# Reuse scout → tzurot-reuse-scout skill
if echo "$PROMPT" | grep -qiE 'don.?t we already have|do we (already )?have (a|an|any)|duplicat\w*|drift(ed)? cop|consolidat'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-reuse-scout"
fi

# Design Boulder → tzurot-design-boulder skill
if echo "$PROMPT" | grep -qiE 'boulder|design session|design pass|architecture design'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-design-boulder"
fi

# MCP Council → tzurot-council-mcp skill
if echo "$PROMPT" | grep -qiE 'mcp|council|second.?opinion|stuck|brainstorm'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-council-mcp"
fi

# Architecture Audit → tzurot-arch-audit skill
if echo "$PROMPT" | grep -qiE 'arch.*audit|audit.*arch|boundary.*check|depcruise.*audit'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-arch-audit"
fi

# Session mining → tzurot-session-mining skill
# \b anchors "mine" so "determine/undermine ... session" don't false-match.
# Keep the pattern free of a trailing \b before "session": with ugrep's
# default engine standing in for grep (some dev machines), that form
# returned zero matches for the first branch while GNU grep matched —
# probe any edit against BOTH greps. "keep (happen|occur|recur)" scopes
# to the meta/process phrasing; bare "keep" swallowed bug-report language
# ("keep failing in CI") that belongs to tzurot-bug-remediation.
if echo "$PROMPT" | grep -qiE '\bmine\b.*session|session.*mining|mined[ -]corpus|friction.*(audit|mining|report)|why do(es)? th(is|ese) keep (happen|occur|recur)'; then
    RELEVANT_SKILLS="$RELEVANT_SKILLS tzurot-session-mining"
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
