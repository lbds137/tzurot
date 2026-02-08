---
name: tzurot-arch-audit
description: 'Architecture health audit. Invoke with /tzurot-arch-audit to run static analysis, check boundaries, and assess code health.'
lastUpdated: '2026-02-07'
---

# Architecture Audit Procedure

**Invoke with /tzurot-arch-audit** to audit codebase architecture and health.

Run this periodically (before PRs, start of session, after major changes) to catch boundary violations, dead code, duplication, and coverage gaps.

Standards live in `.claude/rules/01-architecture.md`. Rationale in `docs/reference/STATIC_ANALYSIS.md`. This skill is the verification procedure.

## Quick Scan

Fast triage (~30 seconds). Run frequently — before PRs or at session start.

```bash
pnpm ops xray --summary     # Package health warnings
pnpm ops xray --suppressions # Suppression audit (tech debt)
pnpm depcruise               # Boundary violations vs baseline
pnpm ops test:audit          # Coverage ratchet status
```

**If all green** (no new warnings, violations, or gaps): stop here.

**If anything flags**: proceed to the relevant Deep Dive section below.

## Deep Dive

Work through each section that the quick scan flagged, or run all 7 periodically.

### 1. Service Boundaries

**Tool:** `pnpm depcruise`

**What it catches:**

- Prisma imports in bot-client (error)
- Cross-service direct imports (error)
- Circular dependency chains (error)
- ai-worker importing Discord.js directly (warn)

**Interpreting results:**

```bash
pnpm depcruise                # Shows NEW violations beyond baseline
pnpm depcruise:baseline       # Update baseline after fixing violations
```

| Result                   | Meaning         | Action                                                          |
| ------------------------ | --------------- | --------------------------------------------------------------- |
| `0 new violations`       | Clean           | None                                                            |
| New `error` severity     | Boundary broken | **Fix now** — move shared code to common-types or use API calls |
| New `warn` severity      | Soft boundary   | **Track** — add to backlog if pattern is spreading              |
| Baseline count decreased | Progress        | Run `pnpm depcruise:baseline` to lock in improvement            |

**Current baseline:** 54 circular dependency violations (pre-existing). New circular deps beyond baseline are flagged.

**Reference:** `.dependency-cruiser.cjs` for rule definitions, `.dependency-cruiser-baseline.json` for known violations.

### 2. Package Health

**Tool:** `pnpm ops xray --summary`

**What it catches:**

- Files approaching or exceeding 400/500 line limits
- Packages exceeding 3000 total lines or 50+ exports
- ESLint suppression clusters (>20 suppressions in one file)

**Interpreting results:**

| Warning                 | Threshold           | Action                                                         |
| ----------------------- | ------------------- | -------------------------------------------------------------- |
| File >400 lines         | 400 warn, 500 error | **Fix now** if >500 (ESLint blocks). **Track** if 400-500.     |
| Package >3000 lines     | 3000                | **Track** — consider splitting. Watch common-types especially. |
| Package >50 exports     | 50                  | **Track** — sign of bloated API surface.                       |
| Suppression cluster >20 | 20                  | **Track** — file may need refactoring instead of suppressing.  |

**Deeper investigation:**

```bash
pnpm ops xray <package-name>            # Full declarations for one package
pnpm ops xray --include-private         # Include non-exported declarations
```

### 3. Suppression Audit

**Tool:** `pnpm ops xray --suppressions`

**What it catches:**

- Lint/type suppressions without justification comments
- Rules suppressed most frequently (potential systemic issues)
- Packages with highest suppression density
- "pre-existing" tech debt vs intentional suppressions

**Interpreting results:**

| Finding                       | Action                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| No justification suppressions | **Fix now** — add `-- reason` or fix the underlying issue     |
| High count for a single rule  | **Track** — may indicate a systemic issue needing refactoring |
| "pre-existing" dominates      | **Track** — chip away during related changes                  |
| Single file with many supprs  | **Track** — file may need refactoring instead of suppressing  |

**Single package audit:**

```bash
pnpm ops xray bot-client --suppressions   # Audit one package
```

### 4. Dead Code

**Tool:** `pnpm knip`

**What it catches:**

- Unused exported functions, types, constants
- Files not imported by any entry point
- Dependencies in package.json not used in code
- Unlisted dependencies (used but not declared)

**Interpreting results:**

| Finding                             | Action                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Unused export in service code       | **Fix now** — remove the export                                           |
| Unused export in common-types       | Verify not used at runtime (check all services). If truly unused, remove. |
| Unused dependency                   | **Fix now** — `pnpm remove <dep>` from the relevant package               |
| Unlisted dependency                 | **Fix now** — `pnpm add <dep>` to the relevant package                    |
| False positive (runtime-only usage) | **Accept** — add to `knip.json` ignore                                    |

**Auto-fix (review diff before committing):**

```bash
pnpm knip:fix    # Removes unused exports
```

### 5. Code Duplication

**Tool:** `pnpm cpd`

**What it catches:**

- Copy-pasted code blocks across files
- Total duplication percentage vs 5% threshold

**Interpreting results:**

```bash
pnpm cpd              # Console output
pnpm cpd:report       # HTML report in reports/jscpd/
```

| Finding                    | Action                                       |
| -------------------------- | -------------------------------------------- |
| Cross-service duplication  | **Fix now** — extract to common-types        |
| Within-service duplication | **Track** — extract helper if >3 occurrences |
| Total >5%                  | **Fix now** — CI will fail                   |
| Test file duplication      | **Accept** — tests are excluded from CPD     |

**Suppressing intentional duplication:**

```typescript
/* jscpd:ignore-start */
// Reason: <explain why duplication is intentional>
/* jscpd:ignore-end */
```

### 6. Test Coverage

**Tool:** `pnpm ops test:audit`

**What it catches:**

- New API schemas without corresponding tests
- New Prisma services without test coverage
- Coverage gaps below 80% threshold

**Interpreting results:**

```bash
pnpm ops test:audit              # Check current state vs baseline
pnpm ops test:audit --update     # Update baseline after closing gaps
```

| Finding                    | Action                                              |
| -------------------------- | --------------------------------------------------- |
| "NEW gaps found"           | **Fix now** — write tests, never add to `knownGaps` |
| Existing `knownGaps` items | **Track** — chip away at tech debt                  |
| Coverage below 80%         | **Fix now** — Codecov blocks PRs                    |

**Baseline file:** `.github/baselines/test-coverage-baseline.json`

**Critical rule:** Never add new code to `knownGaps`. That baseline is for pre-existing tech debt only.

### 7. Full Structure Review

**Tool:** `pnpm ops xray --format md`

**When:** Periodically (monthly or after major feature work), not every session.

**What to look for:**

```bash
pnpm ops xray --format md              # Full markdown report
pnpm ops xray --format md --imports    # Include import analysis
pnpm ops xray --summary --output f     # Write summary to file for diffing
```

| Pattern                        | What it suggests                                       |
| ------------------------------ | ------------------------------------------------------ |
| One package dwarfs others      | Extraction candidate — is it doing too much?           |
| Package with 0 exports         | Dead package or missing entry point                    |
| High import fan-in on one file | Potential god-module, consider splitting               |
| common-types >50 exports       | Bloat — extract domain-specific packages               |
| Circular import patterns       | Architectural coupling — may need interface extraction |

## Findings Template

Use this format to report audit results:

```markdown
## Architecture Audit — YYYY-MM-DD

### Metrics

| Metric           | Current | Baseline | Trend |
| ---------------- | ------- | -------- | ----- |
| Circular deps    | NN      | 54       | +/-N  |
| CPD %            | N.N%    | 5% max   | +/-N  |
| Knip findings    | NN      | —        | —     |
| Coverage gaps    | NN      | NN       | +/-N  |
| Files >400 lines | NN      | —        | —     |

### Fix Now

- [ ] Item (tool that flagged it)

### Track (add to BACKLOG.md)

- [ ] Item (current value → target)

### Accepted (reviewed, intentional)

- Item (reason)
```

## After Audit

1. Fix "Fix Now" items immediately
2. Update baselines to lock in improvements:
   ```bash
   pnpm depcruise:baseline          # If circular deps decreased
   pnpm ops test:audit --update     # If coverage gaps closed
   ```
3. Add "Track" items to `BACKLOG.md` Inbox
4. Commit: `docs: architecture audit YYYY-MM-DD` or `fix: address architecture audit findings`

## References

- Architecture rules: `.claude/rules/01-architecture.md`
- Static analysis rationale: `docs/reference/STATIC_ANALYSIS.md`
- Test coverage baseline: `.github/baselines/test-coverage-baseline.json`
- Dependency cruiser config: `.dependency-cruiser.cjs`
- Dependency cruiser baseline: `.dependency-cruiser-baseline.json`
- Knip config: `knip.json`
- CPD config: `.jscpd.json`
