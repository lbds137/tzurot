---
name: tzurot-council-mcp
description: 'Multi-perspective AI consultation. Invoke with /tzurot-council-mcp for major refactors (>500 lines), structured debugging after failed attempts, or when a technical decision has multiple viable approaches (`debate` for contested ones).'
lastUpdated: '2026-09-24'
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

## Debate Procedure

**Use for** a contested design decision with two or more viable options — where you would otherwise ask one model and trust it, or hand-run a parallel panel plus a tiebreaker. **Not for** single-answer questions, code review, or debugging; `ask`, `code_review` and `debug` serve those.

```typescript
mcp__council__debate({
  topic: 'Job fan-out for memory backfill: Redis Streams or BullMQ?',
  positions: ['Use Redis Streams', 'Use BullMQ'], // 2–4; omit for each model's own view
  // models: 1–4 (default ~openai/gpt-sol-latest, ~z-ai/glm-latest, ~moonshotai/kimi-latest)
  // synthesis_model: defaults to the active model
  // rounds: 1 = openings only; 2 = openings + rebuttals (default)
});
```

With `positions` set, debater _i_ uses `models[i % models.length]` (the schema's own rule) — two positions against the three-model default use only the first two models, and more positions than models cycles so one model argues two stances.

**Cost and time**: one call per debater per round plus the synthesis — 7 calls by default, several minutes with reasoning models. For a cheap run pass `rounds: 1` or GLM-only `models` (flat-rate plan).

**Reading the result**: the synthesis's recommendation is ONE model's reading, not a verdict — report the real disagreements it lists, not just the pick. A failed debater renders as a `⚠️ … failed:` line under its heading and is dropped, and the debate continues, while at least two debaters answered (probed: three debaters with one invalid model id ran as two and still synthesized). Below two respondents the call errors with `Too few debaters answered to hold a debate` — no partial result. The footer's debater and call counts include the failed slot, so read the ⚠️ lines, not the footer, for who answered. The respondent-count vocabulary rule in § Model Selection (below) applies to the debaters who answered. When the debaters share a family, pass a `synthesis_model` from a different one.

## Model Selection

### Always call `list_models` first

**Council model IDs drift faster than most other tool parameters.** Providers rename and remove preview models as they ship new versions — IDs cached from a prior session, skill, or doc are often wrong by the time you use them.

**Always call `mcp__council__list_models` before specifying a model by ID.** Don't trust IDs in this skill, in code comments, or in your own memory.

```typescript
// Run BEFORE picking a model:
mcp__council__list_models({ provider: 'z-ai' });
mcp__council__list_models({ provider: 'moonshotai' });
mcp__council__list_models({ search: 'latest' }); // every floating alias

// Or get a task-based recommendation:
mcp__council__recommend_model({ task: 'reasoning' });
```

(Cached IDs from prior sessions are landmines — a preview model has 404'd mid-session after being superseded.)

**Aliases are the default form**: `~vendor/family-latest` floats to the family's current release, which is the fix for ID drift. Use a pinned ID only where no alias exists — today that is Qwen (`qwen/qwen3.8-max-0902`; re-resolve it via `list_models({ provider: 'qwen' })`).

### When a model 404s mid-session

End the failed session, call `list_models` to find a replacement with similar capabilities (reasoning → reasoning, coding → coding), and restart. **Do not retry the original ID** — it's gone, not transient.

### Recommended models by task

| Task Type        | Recommended Models                                                                                      | Notes                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Reasoning/Design | `~z-ai/glm-latest` · `~moonshotai/kimi-latest` · `~deepseek/deepseek-pro-latest` · Qwen (pinned, above) | The design panel — run all four in parallel |
| Reasoning (solo) | `~openai/gpt-astra-latest`, `~google/gemini-pro-latest`, `~openai/gpt-sol-latest`                       | `recommend_model({ task: 'reasoning' })`    |
| Coding/Review    | `~openai/gpt-sol-latest`, `~deepseek/deepseek-pro-latest`, `~moonshotai/kimi-latest`                    | `~openai/gpt-astra-latest` for heavy coding |
| Vision/Images    | `~google/gemini-pro-latest`, `qwen/qwen3.8-max-0902`, `~moonshotai/kimi-latest`                         | Re-resolve the Qwen pin via `list_models`   |
| Long Documents   | `~google/gemini-pro-latest`, `~z-ai/glm-latest`, `~deepseek/deepseek-pro-latest`                        | All 1M context                              |

**No Anthropic models**: the owner's policy is that council supplies other families' perspectives, because Claude Code already spawns its own independent Claude reviewers. An explicit `~anthropic/...` override works but is never the recommendation. When a listed model is unavailable, fall back to another listed family (or the same family's cheaper tier, e.g. `~deepseek/deepseek-flash-latest`).

**Cost**: the default and active model is `~openai/gpt-sol-latest`. GLM calls route to the flat-rate Z.ai coding plan (one retry on OpenRouter), so GLM is nearly free and cheap to run wide; every other family bills per token on OpenRouter.

**DeepSeek R1 stays off the roster**, on explicit user feedback — it is dated and design questions need SOTA. That is a judgment about R1, not about the vendor: the current DeepSeek Pro is a later generation and carries none of R1's exclusion. Don't read "avoid DeepSeek" as a family-wide ban, and don't reinstate R1 as a fallback; fall back to the family's Flash tier instead, then to another listed family.

**Kimi specifically**: `~moonshotai/kimi-latest` has **capacity pressure under demand** — expect occasional long waits (a council call has exceeded the 120s foreground window and backgrounded). Falling back to the prior pinned Kimi release from `list_models` is a sanctioned practical compromise when the current one is unavailable, not a preference.

**An empty response body is a distinct failure from a 404.** A superseded or overloaded model can return a well-formed response whose content is empty — observed on `kimi-k2.7-code`, and separately explainable by that family's reasoning-tag quirks. Treat an empty body as "this model did not answer": re-run once on the CURRENT model for that family before spending a tiebreaker slot, and never count it as a verdict. A silent member shrinks the panel rather than abstaining. Say how many actually answered, then read the outcome against the RESPONDING panel as though that were the whole panel — the general rule, of which these are only examples: three answering 2-1 is a three-model split, not a 3-1 majority; three answering 3-0 is a three-model consensus, not a 4-0. Silence never reads as a "split" in the sense the section below means; that word is reserved for models that actually disagreed. **Below three respondents, report the count and drop the shape word** — "both models that answered agreed", not "consensus"; "the one model that answered said X", not "unanimous". Consensus implies a panel wide enough to have disagreed, and at N≤2 that breadth is exactly what is missing; this is a floor on the vocabulary, not an exception to the rule above. The 2-2 / 3-1 / 4-0 shapes below assume all four answered.

### Per-call model specification

```typescript
mcp__council__code_review({
  code: myCode,
  model: '~deepseek/deepseek-pro-latest', // verify with list_models first
});
```

## Multi-Turn Conversations

```typescript
// Verify the model ID first (drift!)
const models = await mcp__council__list_models({ search: 'latest' });
// pick a current reasoning alias from the response

// Start session
const { session_id } = await mcp__council__start_conversation({
  model: '~google/gemini-pro-latest', // ⚠️ verify with list_models
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
family than the split participants (any listed family not already on the
panel), give it both positions verbatim, and report the split + tiebreaker
reasoning to the user. Cost is not a blocker for council usage — the user's
standing position is that a better decision is worth the tokens. `debate` with `positions` set to the two sides is the standard way to run the tiebreaker — but pass `models` explicitly, listing only families not on the split panel: the default debate panel (GPT, GLM, Kimi) overlaps the four-model design panel (GLM, Kimi, Qwen, DeepSeek), so the defaults would re-litigate with two models that already voted. The 2-2 rule below still holds — the synthesis argues, it does not vote.

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

All tools are `mcp__council__<name>`; `server_info` lists the live set.

| Tool                       | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `ask`                      | General questions                             |
| `brainstorm`               | Brainstorm ideas                              |
| `debate`                   | 2–4 models argue a decision, then a synthesis |
| `synthesize_perspectives`  | Merge supplied viewpoints into one summary    |
| `code_review`              | Code review                                   |
| `debug`                    | Structured debugging                          |
| `refactor`                 | Refactoring plans                             |
| `test_cases`               | Test case suggestions                         |
| `explain`                  | Explain code/concepts                         |
| `start_conversation`       | Open a multi-turn session                     |
| `continue_conversation`    | Send the next turn in a session               |
| `get_conversation_history` | Read a session's turns                        |
| `list_conversations`       | List open sessions                            |
| `end_conversation`         | Close a session (optionally summarize)        |
| `list_models`              | Search available model IDs and aliases        |
| `recommend_model`          | Task-based model recommendations              |
| `set_model`                | Change the active (default) model             |
| `server_info`              | Version, tools, active model, call stats      |
