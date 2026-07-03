---
name: tzurot-council-mcp
description: 'Multi-perspective AI consultation. Invoke with /tzurot-council-mcp for major refactors (>500 lines), structured debugging after failed attempts, or when a technical decision has multiple viable approaches.'
lastUpdated: '2026-07-03'
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

(Cached IDs from prior sessions are landmines — a preview model has 404'd mid-session after being superseded.)

### When a model 404s mid-session

End the failed session, call `list_models` to find a replacement with similar capabilities (reasoning → reasoning, coding → coding), and restart. **Do not retry the original ID** — it's gone, not transient.

### Recommended models by task

| Task Type        | Recommended Models                                                                                    | Notes                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Reasoning/Design | **GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max** (run all three in parallel) → Claude Sonnet/Opus fallback | **Avoid DeepSeek R1** — dated; design needs SOTA. Verify IDs via `list_models` (they drift) |
| Coding/Review    | Claude Sonnet 4, Claude Opus 4                                                                        | Tool-use variants of Gemini also work for structured refactor tasks                         |
| Vision/Images    | Gemini 2.5 Flash, Gemini 2.5 Pro                                                                      | (verify availability with `list_models`)                                                    |
| Long Documents   | Gemini (1M token context)                                                                             | (verify availability with `list_models`)                                                    |

**Why avoid DeepSeek R1 for reasoning/design**: explicit user feedback — R1 is dated; design questions need SOTA. For open design decisions, run the current preferred trio in parallel — **GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max** — and verify each ID via `list_models` first (the registry can lag a new release; fall back to the prior version of the same family). If those are unavailable, fall back to Claude Sonnet / Opus, **not** R1.

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

## Verify Premises Before Submitting

**Garbage in, garbage out — a council run on a false premise wastes the whole
pass.** Before submitting a design question, verify every factual claim in the
prompt against the repo (read the actual routes/docstrings/config, don't
paraphrase from memory). A council pass once ran on an oversimplified
description built from a stale docstring and had to be fully re-run. If the
user asks to "re-council with the full picture," that's this failure.

## When the Council Splits

Don't silently pick a side. Run a tiebreaker pass with a model from a different
family than the split participants (e.g., Gemini Pro when the trio splits), give
it both positions verbatim, and report the split + tiebreaker reasoning to the
user. Cost is not a blocker for council usage — the user's standing position is
that a better decision is worth the tokens.

## When Council and Claude Disagree

**Evaluate the tension on its merits — do NOT auto-resolve with "our rules always
win."** The user's standing position: if the council proposes something genuinely
better than an existing rule/pattern, they want to consider it. Present the
conflict explicitly (what the rule says, what council proposes, your own
assessment) and let the user decide. Rules win by default only when the council's
case is weak or the rule encodes a hard safety constraint.

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
