---
id: TASK-510
title: Detect repo-escaping fs reads in tooling tests mechanically
status: To Do
assignee: []
created_date: '2026-08-10 20:43'
updated_date: '2026-08-11 14:04'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 510000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: turbo-inputs-coverage.test.ts guards only the roots someone remembered to wire into REQUIRED_ROOTS. The PR 2054 enumeration missed 3 live-sweep test files on the first pass (handler-paths, coverageTopology, protectedIndexRegistries - caught by review round 3), proving the manual-audit step does not scale to guard number 10+. A new tooling test that reads outside the package next month silently escapes the cache-inputs contract again.
Fix shape (reviewer sketch, PR 2054 round 3): a lint- or AST-based check that flags any readFileSync/readFile/existsSync/readdirSync/findFiles call in a *.test.ts under packages/tooling/src whose resolved path climbs outside the package (e.g. a ../../../.. or repoRoot resolution) and is not covered by a REQUIRED_ROOTS entry / turbo.json glob. Could live inside turbo-inputs-coverage.test.ts as a source-scanning describe block.
Acceptance: adding a tooling test that reads a new outside-package tree fails CI until the tree is declared in turbo.json + REQUIRED_ROOTS.

MEASURED 2026-08-11 (grounding pass; also the basis for the size:S to size:M relabel). Numbers re-derived per-set after a first pass conflated two overlapping greps — the counts below are the corrected ones:

- **19** test files under packages/tooling/src carry the literal 4-level climb `../../../..` from `src/<subdir>/`, written as `resolve(__dirname, ...)`, `join(import.meta.dirname, ...)`, or `new URL(..., import.meta.url)`. All three forms are statically detectable without an AST; the climb depth is the signal, not the fs call.
- **26** files carry SOME escape signal (the climb, or a `repoRoot`/`REPO_ROOT`/`process.cwd()` mention). The 7-file difference is the trap for anyone building this scan: `codegen/command-types.test.ts` writes the same climb as SEGMENTED arguments — `resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')` — which no `../../../..` literal grep can see. A scan keyed on the joined literal alone under-detects by construction, and its emptiness would read as coverage.
- Only **1** of the 19 mocks node:fs wholesale (check-boundaries), making its reads fake and cache-irrelevant; `vi.mock('node:fs'` is a cheap first exclusion but eliminates far less than it appears to.
- Three sub-shapes among the real readers, and the middle one is why this is not size:S:
  (a) STATIC ROOT — the literal names the tree outright (`'../../../../prisma/drift-ignore.json'`, `'../../../../.claude/hooks/lib'`, `'../../../../services/api-gateway/src/routes'`). Directly checkable against REQUIRED_ROOTS.
  (b) ROOT-THEN-JOIN — the file resolves the repo root and joins sub-paths from an IMPORTED constant (canary, check-audit-tool-docs, check-gate-parity, check-hook-probes, check-hook-probes-registry, check-monitor-command, check-ops-doc, check-prompt-tags, both eslint allowlists). The roots exist but are not literals in the file, so the scan cannot read them off the source; each needs registering against the constant it consumes.
  (c) INTERPOLATED — `new URL(\`../../../../${rel}\`, import.meta.url)` (ghReadPartsAgreement, gitCommitPatternAgreement). No static root at all.
- A computed path is NOT a read: codegen/command-types.test.ts resolves the repo root and then only writes into an mkdtemp dir. Flagging on the climb alone would report it, so the manifest needs an explicit "computes but does not read" disposition with a reason — which is the classification work, and it is per-file across the full signal set of 26.

Design implication: the check cannot be a pure pattern scan. It wants a manifest (file to roots-it-reads, or an exemption reason), with the scan asserting only that every escape-signalling file APPEARS in the manifest. That inverts the failure mode correctly: a new file fails closed until someone classifies it, which is exactly the acceptance criterion, and it does not require statically resolving (b) or (c).
<!-- SECTION:DESCRIPTION:END -->
