---
name: tzurot-reuse-scout
description: 'Pre-write reuse scouting + drifted-duplicate consolidation. Invoke with /tzurot-reuse-scout before writing new detection/normalization/resolution logic, or when a bug is found in logic that exists in more than one place.'
lastUpdated: '2026-07-05'
---

# Reuse Scout Procedures

**Invoke with /tzurot-reuse-scout** at two decision points:

1. **Before writing** any new detection, normalization, resolution, formatting,
   or classification logic ("is this attachment a voice message?", "which
   config applies?", "how do I render this list row?").
2. **When a bug is found in duplicated logic** — logic that exists, possibly
   slightly differently, in more than one place.

Why this skill exists: semantically-drifted duplicates have caused multiple
prod bugs, and CPD only catches _literal_ duplication — semantic drift ("does
the same job slightly differently") is invisible to it, so the defense is
procedural.

## Decision point 1 — the pre-write scout

Before implementing, search for an existing primitive with ≥3 vocabulary
variants (your term, the domain's term, the library's term):

```bash
pnpm ops xray --format md | grep -iE 'termA|termB|termC'   # every export, cannot be stale
grep -rn "concept" packages/ services/ --include="*.ts" -l
pnpm knip:dead                                              # dormant scaffolding counts as prior art
```

- Check the shared-utility tables first: `04-discord.md` § Shared Utilities,
  `01-architecture.md` § Autocomplete Utilities.
- **The owner's "don't we already have X?" is a search order, not a debate
  prompt** — vague memory has repeatedly beaten confident absence claims
  (`00-critical.md` § negative existence claims).
- Found something? Extend or call it — don't fork it. Found something _almost_
  right? Apply the 2-callback ceiling (`02-code-standards.md`) before deciding
  between extending and writing anew; if writing anew, note in the PR why the
  existing one didn't fit.

## Decision point 2 — the consolidation sweep

When a bug lives in duplicated logic:

- **Enumerate ALL copies deterministically** (xray/grep by behavior keywords,
  not just the 1–2 copies in view) — fixing the visible copy while a drifted
  sibling survives is the recurring failure.
- Consolidate to ONE source of truth (a `common-types` helper, a single
  resolver) and convert every copy to a call site. If consolidation is genuinely
  out of scope, fix every copy identically NOW and file the consolidation with
  the full copy list.
- Prefer **authoritative registries over heuristics**: schema-derived lists,
  exported constants, `as const` tables — not string-suffix sniffing or
  hand-maintained parallel lists (those drift).
- `pnpm ops guard:duplicate-exports` catches same-name exports; it does NOT
  catch same-behavior-different-name — that's this sweep.

## Boundary

Don't over-rotate into Wrong Abstraction: duplication of _skeleton shape_
(standardized call sites of a shared helper) is fine and deliberately excluded
by the CPD post-filter. The target is duplicated _decisions_ — two places that
can disagree about the same question.
