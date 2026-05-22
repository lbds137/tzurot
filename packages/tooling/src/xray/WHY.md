# Why `xray` exists

## What it does

Static-analyzes the monorepo into a structured report: per-package declarations (exported and optionally private), file-level summary, complexity warnings, and (via `--suppressions`) an audit of every `eslint-disable` / `ts-expect-error` comment in the codebase with its justification.

Output formats: `--format terminal` (default, colored), `--format md` (for LLM consumption), `--format json` (for tooling). The `--summary` mode condenses to a file-level overview without per-declaration listing.

Optional modes:

- `--include-private` — includes non-exported declarations
- `--include-tests` — includes test files
- `--imports` — adds import-graph analysis (automatic for md/json)
- `--suppressions` — audits lint-suppression justifications against the standards in `02-code-standards.md`

## Why it was built

Architectural drift is invisible at the diff-review level: a service package quietly grows from 30 to 50 exported types over several PRs, and nobody notices the API surface ballooned. Likewise, lint-suppression comments accumulate without justification — "fix later" comments outlive both the bug and the contributor who wrote them.

`xray` is the periodic-check tool that surfaces these patterns. It's the answer to "what does this codebase actually contain right now?" without having to read every file. The `--format md` output is specifically designed to be pasted into AI-assistant context for architectural questions; the `--suppressions` mode is the static analog of code review for `eslint-disable` justifications.

The `--summary` mode was added when full-mode output got too long for routine use; full mode lists every declaration, which is useful for exhaustive audits but overwhelming for "is this package healthy?" checks.

The suppression-audit threshold targets in `02-code-standards.md` ("target 0 unjustified items") rely on this tool — without it, the rule would be unenforceable.

## Threshold rationale

`xray` itself doesn't fail CI — it's an inspection tool. The thresholds it enforces are in other tools' configs:

- Package size: ~3000 lines / 50 exports per `common-types`-class package (per `01-architecture.md`)
- Suppression justification quality: per the `02-code-standards.md` "lint suppression standards" table

If `xray` reports a package crossing a size threshold, the fix is to split the package (extract a domain-specific sub-package), not to raise the threshold.

## Decay check

When this tool's reminder fires:

- Did the project shrink to a single package (no monorepo)? `xray` becomes less useful; consider switching to a different inspection approach.
- Are LLM tools (Cursor, Claude Code) good enough at codebase-wide reasoning that the `--format md` output is no longer needed? Possibly trim that mode.
- Is the suppression audit producing no findings (all justifications are good)? That's success, not redundancy — keep the audit.
- Has TypeScript-language-server-based tooling improved to where `xray --summary` is equivalent to running TS language services? Migrate or delete.

`xray` is the most "general-purpose" of the audit tools — it's less about catching a specific failure mode and more about surfacing structural facts on demand. Keep it as long as the codebase has multiple packages.
