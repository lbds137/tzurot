---
name: tzurot-gemini-collab
description: Best practices for using Gemini MCP in Tzurot v3 development - When to consult Gemini, how to structure prompts, and cost optimization. Use when planning major changes or needing a second opinion.
lastUpdated: '2025-12-20'
---

# Tzurot v3 Gemini Collaboration

**Use this skill when:** Planning major refactors, debugging complex issues, getting code reviews, brainstorming solutions, or validating architectural decisions.

## Available MCP Tools

| Tool | Purpose |
| --- | --- |
| `mcp__gemini-collab__ask_gemini` | Ask general questions |
| `mcp__gemini-collab__gemini_brainstorm` | Brainstorm ideas/solutions |
| `mcp__gemini-collab__gemini_code_review` | Code review feedback |
| `mcp__gemini-collab__gemini_test_cases` | Test case suggestions |
| `mcp__gemini-collab__gemini_explain` | Explain complex code/concepts |
| `mcp__gemini-collab__synthesize_perspectives` | Combine multiple viewpoints |

## When to Consult Gemini

### ✅ Always Use For:

**Major Refactorings (>500 lines)**
```typescript
mcp__gemini-collab__gemini_brainstorm({
  topic: 'Risks in refactoring PersonalityService',
  constraints: 'Must maintain exact functionality'
});
```

**Production Issues**
```typescript
mcp__gemini-collab__ask_gemini({
  question: 'What causes memory leak in BullMQ workers?',
  context: 'Workers OOM after 2 hours. No obvious leaks.'
});
```

**Before Completing Major PRs**
```typescript
mcp__gemini-collab__gemini_code_review({
  code: changes,
  focus: 'behavior preservation, edge cases',
  language: 'typescript'
});
```

**When Thinking "This seems unnecessary"**
**STOP!** Consult Gemini before removing code.

### ❌ Don't Use For:

- Questions answered by existing docs/skills
- Obvious code issues (typos, syntax errors)
- Small style preferences

## Prompt Structuring

```typescript
// ❌ BAD - No context
mcp__gemini-collab__ask_gemini({ question: 'How do I fix this?' });

// ✅ GOOD - Full context
mcp__gemini-collab__ask_gemini({
  question: 'How do I fix race condition in webhook reply tracking?',
  context: 'Using Redis to map message IDs. Bot-client and api-gateway both access Redis.'
});

// ❌ BAD - Generic review
mcp__gemini-collab__gemini_code_review({ code: myCode });

// ✅ GOOD - Focused review
mcp__gemini-collab__gemini_code_review({
  code: myCode,
  focus: 'resource leaks, error handling, Redis connection management',
  language: 'typescript'
});
```

## The Safety Stack

**Thinking → MCP → Action**

1. Use thinking keywords to analyze ("Ultrathink about...")
2. Consult Gemini for second opinion
3. Follow project guidelines

## Cost Optimization

### ✅ Cost-Effective

- One-time architectural decisions
- Complex bug investigation
- Pre-merge code review

### ❌ Cost-Ineffective

- Repeatedly asking same question (document it!)
- Sending entire files (send relevant snippets)
- Questions answered by docs/skills

## Gemini Limitations

**Gemini doesn't have access to:**
- Your local filesystem
- Project-specific documentation (unless provided)
- Git history

**Always validate against:**
- Project guidelines (CLAUDE.md, skills)
- Existing codebase patterns
- Architecture decisions

## When Gemini and Claude Disagree

**Resolution hierarchy:**
1. Project guidelines (CLAUDE.md, skills)
2. Existing codebase patterns
3. Technical correctness
4. User preference

## Related Skills

- **tzurot-architecture** - Major design decisions
- **tzurot-docs** - Document Gemini recommendations
- **tzurot-security** - Security pattern validation
- **tzurot-testing** - Test case suggestions

## References

- MCP tools: `mcp__gemini-collab__*` functions
- Thinking keywords: `~/.claude/CLAUDE.md#mandatory-thinking-requirements`
- Project guidelines: `CLAUDE.md`
