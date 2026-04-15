# ADR-NNNN: Short title of the decision

> **Status**: Proposed | Accepted | Superseded by ADR-NNNN
> **Date**: YYYY-MM-DD
> **Deciders**: (names or roles)
> **Context epic/PR**: (link if applicable)

## Context

What is the problem or constraint that requires a decision? A few
sentences — enough for a future reader to understand the situation
without needing to read the whole PR thread.

State the forces at play: performance, maintainability, consistency
with existing patterns, user-visible behavior, scope/effort, etc.

## Decision

The decision itself, stated clearly in one to three sentences.

Use active voice: "We chose X because Y." Don't hedge — future readers
can't tell if "we decided to consider doing X" means X happened or not.

## Consequences

### Positive

- What does this enable?
- What problems does it solve?
- What previously-hard things become easier?

### Negative

- What tradeoffs did we accept?
- What new constraints apply to future work?
- What did we give up?

### Neutral

- What cross-cutting changes ripple from this? (e.g., "all future
  persona creation must go through X")
- What deprecations or migrations does this imply?

## Alternatives considered

For each meaningful alternative, write 2-3 sentences:

- **Alternative 1**: What it was. Why we didn't pick it.
- **Alternative 2**: What it was. Why we didn't pick it.

If only one approach was ever on the table, say so explicitly:
"No alternatives considered — this was the obvious path because X."
Don't manufacture fake alternatives for narrative symmetry.

## Follow-ups / open questions

- Things deferred that aren't blocking this decision
- Questions that came up but don't need to be resolved right now
- Related work that this decision enables

## References

- Related ADRs
- Related PRs
- Related issues or incidents
- External docs (papers, blog posts, library docs) if they influenced
  the choice

---

## How to use this template

### When to write an ADR

Write an ADR when a decision:

1. **Shapes future code** — "all X must go through Y" patterns, invariants
   that callers must honor, conventions for new code in this area
2. **Is non-obvious in retrospect** — if a future developer would ask
   "why did they do it this way?" and the answer takes more than 30
   seconds to explain from code alone
3. **Trades off something real** — accepted a cost to gain something
   else, and the cost will show up in future work

### When NOT to write an ADR

- Mechanical bug fixes (no decision, just "the code was wrong")
- Small refactors that follow existing patterns
- Anything where the decision is documented adequately in a commit
  message or PR description and won't be referenced again

### Numbering

Scan `docs/reference/architecture/` for existing `ADR-NNNN-*.md` files
and pick the next integer. ADR-0001 if this is the first.

### Supersedure

If a new ADR supersedes an old one, update the old one's status to
`Superseded by ADR-NNNN` but **do not delete it** — the decision trail
matters. The old ADR still documents the thinking at the time.

### Naming

`ADR-NNNN-short-kebab-description.md` — e.g., `ADR-0003-unified-tts-budget.md`.
Short title in the filename, full title in the header.
