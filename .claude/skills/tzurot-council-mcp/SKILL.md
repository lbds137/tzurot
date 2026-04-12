---
name: tzurot-council-mcp
description: 'Multi-perspective AI consultation. Invoke with /tzurot-council-mcp for major refactors (>500 lines), structured debugging after failed attempts, or when a technical decision has multiple viable approaches.'
lastUpdated: '2026-04-11'
---

# Council MCP Procedures

**Invoke with /tzurot-council-mcp** when you need external AI consultation.

## When to Consult Council

### Always Use For

- **Major Refactorings (>500 lines)**
- **Before Completing Major PRs**
- **When Thinking "This seems unnecessary"** - STOP! Consult before removing code.
- **Structured Debugging**

### Don't Use For

- Questions answered by existing docs/skills
- Obvious code issues (typos, syntax errors)
- Small style preferences

## Debugging Procedure

```typescript
mcp__council__debug({
  error_message: 'Memory leak in BullMQ workers',
  code_context: 'Workers OOM after 2 hours',
  previous_attempts: ['Checked event listeners', 'Reviewed Redis connections'],
});
```

## Code Review Procedure

```typescript
mcp__council__code_review({
  code: changes,
  focus: 'behavior preservation, edge cases',
  language: 'typescript',
});
```

## Refactoring Plan Procedure

```typescript
mcp__council__refactor({
  code: myCode,
  goal: 'reduce_complexity', // extract_method, simplify_logic, improve_naming, etc.
  language: 'typescript',
});
```

## Brainstorming Procedure

```typescript
mcp__council__brainstorm({
  topic: 'Risks in refactoring PersonalityService',
  constraints: 'Must maintain exact functionality',
});
```

## Model Selection

### Always call `list_models` first

**Council model IDs drift faster than most other tool parameters.** Providers rename and remove preview models as they ship new versions — IDs cached from a prior session, skill, or doc are often wrong by the time you use them.

**Always call `mcp__council__list_models` before specifying a model by ID.** Don't trust IDs in this skill, in code comments, or in your own memory.

```typescript
// Run BEFORE picking a model:
mcp__council__list_models({ provider: 'google', search: 'gemini' });
mcp__council__list_models({ provider: 'anthropic', search: 'claude' });

// Or get a task-based recommendation:
mcp__council__recommend_model({ task: 'reasoning' });
```

**Known drift incident (2026-04-09)**: `google/gemini-3-pro-preview` returned 404 mid-session — it had been superseded by `google/gemini-3.1-pro-preview`. Cached IDs from prior sessions are landmines.

### When a model 404s mid-session

End the failed session, call `list_models` to find a replacement with similar capabilities (reasoning → reasoning, coding → coding), and restart. **Do not retry the original ID** — it's gone, not transient.

### Recommended models by task

| Task Type        | Recommended Models                              | Notes                                                               |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Reasoning/Design | **Gemini 3.1 Pro Preview** → Claude Sonnet/Opus | **Avoid DeepSeek R1** — it's dated; reasoning/design needs SOTA     |
| Coding/Review    | Claude Sonnet 4, Claude Opus 4                  | Tool-use variants of Gemini also work for structured refactor tasks |
| Vision/Images    | Gemini 2.5 Flash, Gemini 2.5 Pro                | (verify availability with `list_models`)                            |
| Long Documents   | Gemini (1M token context)                       | (verify availability with `list_models`)                            |

**Why avoid DeepSeek R1 for reasoning/design**: explicit user feedback (2026-04-09) — _"In the future, I would recommend not using R1 because again, it is dated. There are better models out there."_ R1 is acceptable for narrow factual queries but not for architectural decisions that ship to users. Default to Gemini 3.1 Pro Preview (or current SOTA equivalent — verify with `list_models`). If Gemini is unavailable, fall back to Claude Sonnet 4 / Opus 4, **not** R1.

### Per-call model specification

```typescript
mcp__council__code_review({
  code: myCode,
  model: 'anthropic/claude-sonnet-4', // verify with list_models first
});
```

## Multi-Turn Conversations

```typescript
// Verify the model ID first (drift!)
const models = await mcp__council__list_models({ provider: 'google', search: 'gemini' });
// pick a current SOTA reasoning model from the response

// Start session
const { session_id } = await mcp__council__start_conversation({
  model: 'google/gemini-3.1-pro-preview', // ⚠️ verify with list_models — IDs drift
  system_prompt: 'You are a TypeScript architecture expert',
  initial_message: 'Review this service design...',
});

// Continue
await mcp__council__continue_conversation({
  session_id,
  message: 'What about the error handling?',
});

// End and summarize
await mcp__council__end_conversation({
  session_id,
  summarize: true,
});
```

## When Council and Claude Disagree

**Resolution hierarchy:**

1. Project guidelines (CLAUDE.md, rules)
2. Existing codebase patterns
3. Technical correctness
4. User preference

## Available Tools

| Tool                            | Purpose               |
| ------------------------------- | --------------------- |
| `mcp__council__ask`             | General questions     |
| `mcp__council__brainstorm`      | Brainstorm ideas      |
| `mcp__council__code_review`     | Code review           |
| `mcp__council__debug`           | Structured debugging  |
| `mcp__council__refactor`        | Refactoring plans     |
| `mcp__council__test_cases`      | Test case suggestions |
| `mcp__council__explain`         | Explain code/concepts |
| `mcp__council__recommend_model` | Model recommendations |
