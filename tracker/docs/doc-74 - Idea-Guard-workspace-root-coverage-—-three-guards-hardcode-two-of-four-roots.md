---
id: doc-74
title: 'Idea: Guard workspace-root coverage — three guards hardcode two of four roots'
type: other
created_date: '2026-08-11 11:52'
---

### Idea: Guard workspace-root coverage

_Focus: make the structural guards scan the workspace roots pnpm actually declares, instead of a hardcoded pair._

**Why.** `pnpm-workspace.yaml` declares four workspace packages: `packages/*`, `services/*`, `scripts`, and `tests`. Three guards hardcode only the first two as their `ROOTS`:

- `packages/tooling/src/dev/check-build-scripts.ts`
- `packages/tooling/src/dev/check-no-export-star.ts`
- `packages/tooling/src/dev/check-dockerfile-dist.ts`

Nothing is unguarded **today** — verified at filing: `tests/package.json` has an empty `scripts` object, and `scripts/package.json` has no `build` key (it does run `tsc --noEmit` for typecheck, and its source is not part of knip's dead-export surface). So this is a coverage gap with no live instance, not a defect.

It matters because of what the guards are FOR. `guard:build-scripts` exists specifically to catch a *new* package silently reintroducing turbo cache poisoning; `scripts/` already invokes `tsc` and is exactly the shape that could grow `"build": "tsc"` later, with no CI signal. A guard against silent reintroduction that cannot see two of the four places a package can appear has a hole in its own premise.

**Why it is a sweep and not a one-line fix.** Widening one guard's `ROOTS` array leaves the three inconsistent, and the next guard added copies whichever one its author read. The fix is a single shared source of truth.

**Fix shape.** A small helper in `packages/tooling/src/dev/` that reads the `packages:` globs out of `pnpm-workspace.yaml` once and expands them to concrete directories; the three guards above consume it instead of their local `ROOTS`. Then a guard's coverage follows the workspace definition automatically — adding a fifth root to `pnpm-workspace.yaml` cannot silently leave the guards behind.

Two things to decide while building it, not before:

- Whether `tests/` should be in scope for every guard or only some (its package is a test-fixture host, so an `export *` there masks nothing knip audits).
- Whether the helper parses the YAML or shells out to `pnpm ls -r --depth -1 --json`. Parsing is dependency-free but has to handle the glob forms; the CLI form is authoritative but adds a subprocess to a fast sync check.

**Acceptance.** One helper, three call sites, no remaining hardcoded root pair in `packages/tooling/src/dev/`; each guard's existing tests still green; and a test proving a package under a non-`packages`/`services` root is actually scanned.

**Members so far.**

1. `check-build-scripts.ts` — surfaced by the PR #2062 review (the guard shipped with the two-root scope; its known limitation is stated in the PR body and the module docstring).
2. `check-no-export-star.ts` — same hardcoded pair.
3. `check-dockerfile-dist.ts` — same hardcoded pair.

**Related.** `TASK-489` (archived as a duplicate of `TASK-32`) asked for the guard over "every **workspace** package" — broader than the two-root scope that actually shipped in #2062. This doc owns that remaining breadth, so the ask is not lost with the duplicate.
