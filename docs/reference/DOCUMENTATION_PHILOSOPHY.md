# Documentation Philosophy

> **Last Updated**: 2026-02-07

> **Quick reference**: `.claude/rules/07-documentation.md` has the placement table and lifecycle rules. This doc covers the full rationale.

This document explains what documentation to keep vs delete in the Tzurot project.

## Core Principle

**Document outcomes, not processes.**

Keep documentation about what the software _does_. Delete documentation about _how we built it_.

## What We Keep

### Feature Documentation

What the app does, how users interact with it.

- Slash command references
- Configuration options
- User-facing behaviors

### Architecture Decisions

ADRs, design patterns, why we chose X over Y.

- Service boundaries and responsibilities
- Data flow explanations
- Pattern justifications

### Reference Docs

CLI commands, API schemas, configuration.

- CLAUDE.md rules
- Skills with project patterns
- CLI command references

### Backlog Proposals

Features that are good ideas but not currently scheduled.

- Lives in `docs/proposals/backlog/`
- **Deleted when implemented** (after extracting learnings to feature docs)
- May be deleted outright if abandoned

> **Note**: The project does **not** use a `docs/proposals/active/` directory. Active work is tracked in `BACKLOG.md` (🎯 Current Focus, 🏗 Active Epic). Proposals stay in `backlog/` until they're either implemented (and deleted) or promoted to a Current Focus item in `BACKLOG.md`.

### Research Notes

Distilled insights from AI consultations (TL;DR format).

- Lives in `docs/research/`
- 2-5KB each (not raw transcripts)
- Links to actionable BACKLOG items

## What We Delete

### Build Process Docs

Test plans, implementation checklists, "how to build X" docs.

**Why delete?** Once shipped, the only relevant info is what the feature does—not how we got there.

**Example**: `MEMORY_COMMANDS_TEST_PLAN.md` deleted after Phase 3 shipped.

### Raw AI Transcripts

Gemini chats, Claude discussions, research sessions.

**Why delete?** 200KB raw transcript → 3KB research note. Git preserves history.

**Process**: Extract to `docs/research/`, then delete raw files.

### Completed Proposals

Feature proposals after implementation.

**Why delete?** The _feature_ should be documented, not the _proposal process_.

**Process**: Ensure feature is documented in reference docs or README, then delete proposal.

### Migration Plans (Never Executed)

Schema designs, migration strategies that were abandoned.

**Why delete?** If we didn't do it, there's nothing to maintain.

**Example**: `LEGACY_MEMORY_SCHEMA_DESIGN.md` deleted (never executed).

### Diverged Planning Docs

Planning documents whose implementation took a meaningfully different shape than what the doc described — distinct from "never executed" (we built _something_), and distinct from "completed proposal" (the thing we built isn't what the doc described).

**Why delete?** The doc describes a structure that doesn't exist. A reader following it will end up confused about what currently exists. Updating is rarely worth it — by the time the divergence is noticed, the actual code is already the better source of truth, and "rewriting the planning doc to match reality" produces something that's neither a useful design artifact nor a useful reference.

**Test**: would a reader following this doc end up confused about what currently exists? If yes, delete.

**Example**: A planning doc proposing `/admin personality` subcommands when the actual implementation moved that functionality to `/preset` — the doc describes an architecture that doesn't exist. Even if the proposal was good and the implementation was inspired by it, the gap between "what we planned" and "what we built" is the load-bearing problem.

## Triage Triggers

Run documentation triage when:

1. **Raw AI files accumulate** in `docs/gemini_chats/` or similar
2. **CLAUDE.md feels incomplete** - patterns exist but aren't documented
3. **Seeing outdated references** in docs while working
4. **Quarterly maintenance** - scheduled cleanup

## Decision Flowchart

```
Is this documentation about...

[Currently implemented feature?]
  → YES → Keep in docs/reference/
  → NO ↓

[Active work in progress?]
  → YES → Track in BACKLOG.md (🎯 Current Focus or 🏗 Active Epic)
  → NO ↓

[Future idea (not scheduled)?]
  → YES → Keep in docs/proposals/backlog/
  → NO ↓

[Completed/shipped work process?]
  → YES → Verify feature is documented, then DELETE
  → NO ↓

[Raw AI consultation?]
  → YES → Distill to docs/research/, then DELETE raw
  → NO ↓

[Abandoned/never-executed plan?]
  → YES → DELETE (git preserves history)
```

## Related Resources

- `.claude/rules/07-documentation.md` - Documentation standards (placement, naming, lifecycle)
- `.claude/skills/tzurot-doc-audit/SKILL.md` - Audit procedure for freshness checks
- `.claude/skills/tzurot-docs/SKILL.md` - Session workflow procedures
- `docs/research/README.md` - Research notes archive
