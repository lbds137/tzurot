---
name: tzurot-gemini-collab
description: Best practices for using Gemini MCP in Tzurot v3 development - When to consult Gemini, how to structure prompts, and cost optimization. Use when planning major changes or needing a second opinion.
---

# Tzurot v3 Gemini Collaboration

**Use this skill when:** Planning major refactors, debugging complex issues, getting code reviews, brainstorming solutions, or validating architectural decisions.

## Available MCP Tools

Tzurot v3 has Gemini 3 Pro available via MCP with these tools:

1. **`mcp__gemini-collab__ask_gemini`** - Ask general questions
2. **`mcp__gemini-collab__gemini_brainstorm`** - Brainstorm ideas/solutions
3. **`mcp__gemini-collab__gemini_code_review`** - Code review feedback
4. **`mcp__gemini-collab__gemini_test_cases`** - Test case suggestions
5. **`mcp__gemini-collab__gemini_explain`** - Explain complex code/concepts
6. **`mcp__gemini-collab__synthesize_perspectives`** - Combine multiple viewpoints

## When to Consult Gemini

### ✅ Always Use Gemini For:

**1. Major Refactorings (>500 lines)**
```typescript
mcp__gemini-collab__gemini_brainstorm({
  topic: "Potential risks in refactoring PersonalityService",
  constraints: "Must maintain exact functionality, no breaking changes"
});
```

**2. Production Issues**
```typescript
mcp__gemini-collab__ask_gemini({
  question: "What might cause memory leak in BullMQ workers?",
  context: "Workers run for 2 hours then OOM. No obvious leaks in code."
});
```

**3. Before Completing Major PRs**
```typescript
mcp__gemini-collab__gemini_code_review({
  code: changes,
  focus: "behavior preservation, missing functionality, edge cases",
  language: "typescript"
});
```

**4. When Thinking "This seems unnecessary"**
**STOP!** Consult Gemini before removing ANY code you think is unnecessary.
```typescript
mcp__gemini-collab__ask_gemini({
  question: "Why might this initialize() call be necessary?",
  context: `Code: ${codeSnippet}`
});
```

**5. Architectural Decisions**
```typescript
mcp__gemini-collab__gemini_brainstorm({
  topic: "Should we use WebSockets or polling for real-time personality updates?",
  constraints: "Railway deployment, 3 microservices, must handle disconnects"
});
```

**6. Complex Debugging**
```typescript
mcp__gemini-collab__ask_gemini({
  question: "Tests pass locally but fail in CI. What are common causes?",
  context: "Using Vitest, fake timers, mocking Discord.js"
});
```

### ⚠️ Consider Using Gemini For:

**1. Test Case Generation**
```typescript
mcp__gemini-collab__gemini_test_cases({
  code_or_feature: "Redis pub/sub cache invalidation service",
  test_type: "edge cases"
});
```

**2. Code Explanation (For Complex Patterns)**
```typescript
mcp__gemini-collab__gemini_explain({
  topic: "How does BullMQ job chaining work with preprocessing?",
  level: "intermediate"
});
```

**3. Multiple Solution Comparison**
```typescript
mcp__gemini-collab__synthesize_perspectives({
  topic: "Best approach for BYOK (Bring Your Own Key) implementation",
  perspectives: [
    { source: "Option A", content: "Per-user API keys in database" },
    { source: "Option B", content: "Per-guild API keys with delegation" },
    { source: "Option C", content: "Hybrid: user keys, guild defaults" }
  ]
});
```

### ❌ Don't Use Gemini For:

**1. Simple Questions Answered by Docs**
- How do I run tests? → Check CLAUDE.md
- What's the PR workflow? → Check git-workflow skill
- Where do constants go? → Check constants skill

**2. Obvious Code Issues**
- Typos, syntax errors, missing imports
- ESLint/TypeScript errors with clear messages
- Simple logic bugs

**3. Micro-Optimizations**
- "Should this be a const or let?"
- "Is this variable name better?"
- Small style preferences

## Prompt Structuring

### For Better Results

**1. Provide Context**
```typescript
// ❌ BAD - No context
mcp__gemini-collab__ask_gemini({
  question: "How do I fix this?"
});

// ✅ GOOD - Full context
mcp__gemini-collab__ask_gemini({
  question: "How do I fix race condition in webhook reply tracking?",
  context: "Using Redis to map message IDs to personalities. Sometimes replies go to wrong personality. Bot-client and api-gateway both access Redis. Discord.js webhooks."
});
```

**2. Specify Constraints**
```typescript
// ❌ BAD - Open-ended
mcp__gemini-collab__gemini_brainstorm({
  topic: "How to improve performance?"
});

// ✅ GOOD - Specific constraints
mcp__gemini-collab__gemini_brainstorm({
  topic: "How to reduce LLM API latency in Tzurot v3?",
  constraints: "Cannot change OpenRouter provider. Must maintain conversation context. Railway deployment (no serverless). Budget: <$50/month."
});
```

**3. Request Specific Focus**
```typescript
// ❌ BAD - Generic review
mcp__gemini-collab__gemini_code_review({
  code: myCode,
  language: "typescript"
});

// ✅ GOOD - Focused review
mcp__gemini-collab__gemini_code_review({
  code: myCode,
  focus: "resource leaks, error handling, edge cases in Redis connection management",
  language: "typescript"
});
```

## Integration with Claude Code Workflow

### The Safety Stack

**Thinking → MCP → Action**

1. **First:** Use thinking keywords to analyze
2. **Then:** Consult MCP for second opinion
3. **Finally:** Follow existing guidelines

**Example Workflow:**
```
You: "This PersonalityManager seems overly complex"

[Internal thinking]: "Ultrathink about what PersonalityManager does before refactoring"

After analysis: "Let me consult Gemini to verify my refactoring plan"

mcp__gemini-collab__gemini_brainstorm({
  topic: "Safety of simplifying PersonalityManager by removing caching layer",
  constraints: "Used by all 3 microservices, currently has LRU cache with 5min TTL"
});

Only then: "Proceed with careful refactoring based on both analyses"
```

## Cost Optimization

Gemini 3 Pro is powerful but not free. Optimize usage:

### ✅ Cost-Effective Uses

**1. One-Time Architectural Decisions**
```typescript
// Worth the cost - prevents costly mistakes
mcp__gemini-collab__gemini_brainstorm({
  topic: "Should Tzurot v3 use WebSockets for real-time updates?",
  constraints: "Railway deployment, cost sensitive, 1-person project"
});
```

**2. Complex Bug Investigation**
```typescript
// Worth it - saves hours of debugging
mcp__gemini-collab__ask_gemini({
  question: "Why do tests fail only in CI?",
  context: "Full error logs and test output"
});
```

**3. Pre-Merge Code Review**
```typescript
// Worth it - catches bugs before production
mcp__gemini-collab__gemini_code_review({
  code: prChanges,
  focus: "behavior preservation, resource leaks, edge cases"
});
```

### ❌ Cost-Ineffective Uses

**1. Repeatedly Asking Same Question**
```typescript
// ❌ BAD - Document the answer!
mcp__gemini-collab__ask_gemini({
  question: "What are Tzurot's testing patterns?"
});
// (Asked 3 times in different sessions)

// ✅ GOOD - Ask once, document in skill
// (You're reading it now!)
```

**2. Sending Full Files**
```typescript
// ❌ BAD - Huge context
mcp__gemini-collab__gemini_code_review({
  code: entireFile,  // 2000 lines
  focus: "general review"
});

// ✅ GOOD - Relevant snippet
mcp__gemini-collab__gemini_code_review({
  code: specificFunction,  // 50 lines
  focus: "error handling in retry logic"
});
```

**3. Brainstorming Obvious Solutions**
```typescript
// ❌ BAD - Answer is in docs
mcp__gemini-collab__gemini_brainstorm({
  topic: "How to structure constants?"
});

// ✅ GOOD - Check tzurot-constants skill first
```

## Real-World Examples

### Example 1: Cache Invalidation Feature

**Context:** Adding Redis pub/sub for cache invalidation

**Gemini Consultation:**
```typescript
// Before implementation
mcp__gemini-collab__gemini_brainstorm({
  topic: "Best approach for cross-service cache invalidation in Tzurot v3",
  constraints: "3 microservices (bot-client, api-gateway, ai-worker). Redis available. Must handle service restarts. Personality configs cached with 5min TTL."
});

// After implementation, before merge
mcp__gemini-collab__gemini_code_review({
  code: cacheInvalidationService,
  focus: "resource leaks, error handling, race conditions",
  language: "typescript"
});
```

**Result:** Gemini identified resource leak in error path (Issue #1 in PR review)

### Example 2: Memory Leak Debugging

**Context:** ai-worker OOM after 2 hours

**Gemini Consultation:**
```typescript
mcp__gemini-collab__ask_gemini({
  question: "What causes memory leaks in Node.js BullMQ workers?",
  context: "Worker processes 50-100 jobs/hour. Each job: load personality, retrieve memories from pgvector, call OpenRouter API, store response. Memory grows linearly. No obvious leaks in heap snapshot."
});
```

**Result:** Gemini suggested checking:
1. Unclosed database connections (pooling issue)
2. Event listener accumulation
3. Large objects in job data not garbage collected

### Example 3: Test Patterns

**Context:** Writing tests for new service

**Gemini Consultation:**
```typescript
mcp__gemini-collab__gemini_test_cases({
  code_or_feature: "ConversationHistoryService with pagination, filtering, and cleanup",
  test_type: "all"
});
```

**Result:** Gemini suggested edge cases we missed:
- Empty result sets
- Pagination with exactly pageSize items
- Cleanup with concurrent writes

## Gemini Limitations

**Be aware:**

1. **Gemini doesn't have access to:**
   - Your local filesystem
   - Project-specific documentation (unless you provide it)
   - Recent conversations with Claude Code
   - Git history

2. **Gemini might suggest:**
   - Patterns that contradict our v3 principles
   - Over-engineered solutions
   - Generic advice not tailored to our stack

**Always validate Gemini suggestions against:**
- Project guidelines (CLAUDE.md, skills)
- Architecture decisions
- Existing patterns in codebase

## When Gemini and Claude Disagree

**Resolution hierarchy:**

1. **Project-specific guidelines** (CLAUDE.md, skills) → Trust these first
2. **Existing codebase patterns** → Consistency matters
3. **Technical correctness** → Both should agree on facts
4. **User preference** → Ask the user to decide

**Example:**
```
Gemini: "Use Repository pattern for database access"
Claude: "Tzurot v3 uses direct Prisma access (rejected DDD)"

Resolution: Follow Claude/project guidelines (anti-pattern documented)
```

## Response Quality

### When Gemini Responses Are Helpful

- Provides 3+ specific suggestions
- References technical concepts with examples
- Identifies edge cases you didn't consider
- Explains trade-offs of different approaches

### When to Re-Prompt

- Generic/obvious advice
- Doesn't consider constraints
- Contradicts known facts
- Too brief or too verbose

**Re-prompt with more context:**
```typescript
// First attempt - vague
mcp__gemini-collab__ask_gemini({
  question: "How to optimize?"
});

// Second attempt - specific
mcp__gemini-collab__ask_gemini({
  question: "How to reduce pgvector memory query latency from 200ms to <50ms?",
  context: "Using cosine distance. Index: ivfflat with 100 lists. 10k vectors. Retrieving top 5. Postgres 14 on Railway."
});
```

## Documentation of Gemini Insights

**When Gemini provides valuable insights:**

1. **Document in relevant skill** (if pattern applies broadly)
2. **Add to CLAUDE.md** (if project-wide principle)
3. **Create ADR in docs/architecture/** (if architectural decision)
4. **Don't rely on memory** - document for future sessions!

## References

- MCP tools: Available via `mcp__gemini-collab__*` functions
- Thinking keywords: `~/.claude/CLAUDE.md#mandatory-thinking-requirements`
- Project guidelines: `CLAUDE.md`
- Architecture decisions: `docs/architecture/ARCHITECTURE_DECISIONS.md`
