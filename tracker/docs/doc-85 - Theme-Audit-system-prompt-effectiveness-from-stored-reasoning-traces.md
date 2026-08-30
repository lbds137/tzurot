---
id: doc-85
title: 'Theme: Audit system-prompt effectiveness from stored reasoning traces'
type: other
created_date: '2026-08-30 19:05'
---

_Focus: turn 30 days of stored reasoning traces into evidence about which parts
of the system prompt are working, so prompt changes are measured rather than
guessed._

## Why

Owner request. We now persist the model's reasoning trace alongside each
conversation-history row, which means we hold a corpus of the AI's *thought
process* — not just its output. That corpus can answer a question we currently
answer by intuition: **where is the model fighting the system prompt?**

The specific target named by the owner is friction around censorship and
refusal behaviour on the bare LLM, which the prompt tries to resolve through
permissive prompting. A reasoning trace often shows the model deliberating about
whether it is allowed to respond — deliberation the final output hides. That
deliberation is the signal: it says the prompt is being *contested* rather than
*obeyed*, and it says which clause is doing the contesting.

## Premises, verified at source

- **Traces are stored on the history row.** `prisma/schema.prisma:700-707` —
  field `thinkingContent` (`@map("thinking_content")`), documented as
  "Deferred-set: the model's reasoning trace for an assistant turn, written once
  at row creation by the assistant-message persist endpoint."
- **The 30-day window is real.** `ConversationRetentionService` defaults to a
  30-day cutoff (`packages/conversation-history/src/ConversationRetentionService.test.ts:173`,
  "should use default 30 days if not specified"). So the corpus is a rolling
  30 days, not an archive — any audit is a sampling tool, and anything worth
  keeping must be extracted before the window closes.

### Coverage caveats the schema already documents — read before sizing anything

`thinkingContent` is null in four distinct cases, and they are NOT
interchangeable:

1. the model produced no trace (**~5% of generations**),
2. the row is a user turn (only assistant rows carry one),
3. the row predates trace persistence,
4. reads fall back to the 24h diagnostic log.

Case 3 is the one that will distort an early audit: the corpus is only as deep
as trace persistence is old, which may be well short of 30 days. **Measure the
oldest non-null `thinking_content` before designing any analysis** — that single
query sets the real corpus size, and it is cheap.

## Relationship to the deferred custom-system-prompt project

The owner is serving a custom system prompt from the database, and
user-customizable prompts are a separate deferred project. These two are
coupled in one direction: **once users can customize the prompt, an audit tool
stops being a nicety and becomes the only way to tell a good customization from
a bad one.** That argues for building the audit capability first, or at least
not letting customization ship without it — but it is the owner's sequencing
call, not an agent's.

Do not fold the customization project into this theme. This theme is the
measurement half.

## Phase sketch (not settled — the first phase decides the rest)

### Phase 1 — Can the corpus answer the question at all?

Before building tooling, hand-read a sample. Pull N traces, read them, and
answer: is refusal-deliberation actually visible and frequent enough to
classify? A negative answer here kills the theme cheaply, which is the point of
putting it first.

Measure the real corpus depth (oldest non-null trace) in the same pass.

### Phase 2 — Classify the friction

Turn the hand-read patterns into categories. Likely axes, to be confirmed rather
than assumed: refusal deliberation, safety hedging that never reaches output,
persona-instruction conflict, confusion about which instruction wins,
context/instruction overflow. Model-specific formatting matters — reasoning
output differs by provider (see the GLM-family and Kimi notes in memory/research
docs), so a classifier that works on one model may silently score zero on
another.

### Phase 3 — Attribute friction to prompt clauses

The payoff step and the hard one: connect a friction instance back to the
clause responsible. Without attribution the audit produces a number nobody can
act on.

### Phase 4 — Close the loop

Make it a repeatable measurement so a prompt change can be evaluated against
before/after, rather than judged by vibes on a handful of conversations.

## Constraints

- **Reasoning traces are user conversation content.** Any extract, sample, or
  report is machine-local working material — `docs/local/` (gitignored), never
  committed, never quoted into a PR body, commit message, or tracked doc. Only
  the operationalized outcome (a prompt change, a tool) enters the repo. Same
  boundary the session-mining skill operates under, for the same reason.
- **No PII in anything the tool logs or emits** (`00-critical.md`).
- Sampling reads a production table — bound every query (`take`), and prefer
  reading from dev or a copy where the analysis allows it.

## Acceptance

Phase 1 answers whether the corpus supports the question, with the real corpus
depth measured rather than assumed; if yes, the theme produces a repeatable way
to measure system-prompt friction, attribute it to prompt content, and compare
two prompt revisions on the same corpus — with every extract staying local.
