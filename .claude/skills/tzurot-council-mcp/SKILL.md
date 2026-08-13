---
name: tzurot-council-mcp
description: 'Multi-perspective AI consultation. Invoke with /tzurot-council-mcp for major refactors (>500 lines), structured debugging after failed attempts, or when a technical decision has multiple viable approaches.'
lastUpdated: '2026-08-13'
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

| Task Type        | Recommended Models                                                                                              | Notes                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Reasoning/Design | **GLM 5.2 · Kimi K3 · Qwen 3.8 Max · DeepSeek v4 Pro** (run all four in parallel) → Claude Sonnet/Opus fallback | **Avoid DeepSeek R1** — dated, and a different generation from v4 Pro. Verify IDs via `list_models` (they drift) |
| Coding/Review    | Claude Sonnet 4, Claude Opus 4                                                                                  | Tool-use variants of Gemini also work for structured refactor tasks                                              |
| Vision/Images    | Gemini 2.5 Flash, Gemini 2.5 Pro                                                                                | (verify availability with `list_models`)                                                                         |
| Long Documents   | Gemini (1M token context)                                                                                       | (verify availability with `list_models`)                                                                         |

**The roster is four**: for open design decisions, run **GLM 5.2 · Kimi K3 · Qwen 3.8 Max · DeepSeek v4 Pro** in parallel (`z-ai/glm-5.2` — 1M context; `moonshotai/kimi-k3` — see the Kimi note below; `qwen/qwen3.8-max` — GA successor to 3.7 Max, 1M context, multimodal reasoning; `deepseek/deepseek-v4-pro` — 1M context, owner addition) and verify each ID via `list_models` first (the registry can lag a new release; fall back to the prior version of the same family). If those are unavailable, fall back to Claude Sonnet / Opus.

**DeepSeek R1 is still off the roster**, on explicit user feedback — it is dated and design questions need SOTA. That is a judgment about R1, not about the vendor: v4 Pro is a later generation and carries none of R1's exclusion. Don't read "avoid DeepSeek" as a family-wide ban, and don't reinstate R1 as a v4 Pro fallback. Fall back to the family's cheaper tier instead; failing that, to Claude. That cheaper tier is real — `deepseek/deepseek-v4-flash` was listed alongside v4 Pro when this line was written, and "flash" is the registry's own branding here rather than a Gemini-ism borrowed by mistake. Re-resolve its exact ID via `list_models` anyway rather than trusting this string.

**Kimi specifically**: `moonshotai/kimi-k3` is the current SOTA pick (verify via `list_models` — this line will go stale exactly the way `kimi-k2.7-code` did); `kimi-k2.7-code` is superseded and should not be the default. K3 has **capacity pressure under demand** — expect occasional long waits (a council call has exceeded the 120s foreground window and backgrounded) — so falling back to the prior K2.x is a sanctioned practical compromise when K3 is unavailable, not a preference.

**An empty response body is a distinct failure from a 404.** A superseded or overloaded model can return a well-formed response whose content is empty — observed on `kimi-k2.7-code`, and separately explainable by that family's reasoning-tag quirks. Treat an empty body as "this model did not answer": re-run once on the CURRENT model for that family before spending a tiebreaker slot, and never count it as a verdict. A silent member shrinks the panel rather than abstaining. Say how many actually answered, then read the outcome against the RESPONDING panel as though that were the whole panel — the general rule, of which these are only examples: three answering 2-1 is a three-model split, not a 3-1 majority; three answering 3-0 is a three-model consensus, not a 4-0. Silence never reads as a "split" in the sense the section below means; that word is reserved for models that actually disagreed. **Below three respondents, report the count and drop the shape word** — "both models that answered agreed", not "consensus"; "the one model that answered said X", not "unanimous". Consensus implies a panel wide enough to have disagreed, and at N≤2 that breadth is exactly what is missing; this is a floor on the vocabulary, not an exception to the rule above. The 2-2 / 3-1 / 4-0 shapes below assume all four answered.

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
family than the split participants (e.g., Gemini Pro), give it both positions
verbatim, and report the split + tiebreaker reasoning to the user. Cost is not a
blocker for council usage — the user's standing position is that a better
decision is worth the tokens.

**A four-model panel is even, so 2-2 is a real outcome** — the trio could always
produce a majority, and this one cannot. Do NOT resolve a 2-2 by counting a
tiebreaker as a fifth vote and declaring 3-2; the tiebreaker's job is to give the
REASON one position beats the other, and it earns its keep by argument, not by
arithmetic. Report the split as a split, name which argument the tiebreaker found
stronger and why, and if it finds neither decisive, say so and hand the owner the
two positions rather than a manufactured winner. The majority-shaped outcomes
(3-1, 4-0) are read the same as before.

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
