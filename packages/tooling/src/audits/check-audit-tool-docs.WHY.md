# Why `guard:audit-tool-docs` exists

## What it does

Reads `AUDIT_TOOL_REGISTRY` and asserts every registered audit tool has a non-stub WHY.md file at the path the registry names. "Non-stub" means `>= 200` characters of non-frontmatter body content. Hard-fails CI on any missing or stub file.

Self-registered: this tool's own entry is in the registry, pointing at this WHY.md. The guard enforces its own rule.

`--summary` mode emits the standardized audit JSONL line for the future aggregator.

## Why it was built

Layer 1 of the audit-enforcement architecture (`docs/reference/audit-enforcement.md`) established that audit tools rot quickly without periodic re-evaluation. Layer 2 added the WHY.md decay-prevention prompt — but a WHY.md per tool is only useful if it actually exists and contains real content. Without structural enforcement, a contributor could:

- Add a new audit tool and forget the WHY.md (silently lose the decay-prevention property for that tool)
- Replace a WHY.md with a stub during a refactor (silently degrade an existing tool's documentation)
- Delete a tool but leave the orphan WHY.md (not currently caught — see below)

This guard catches the first two patterns. The orphan-WHY.md case is documented as a known gap in `audit-tool-registry.ts` and tracked as a future enhancement to this same tool.

The 200-char minimum is a deliberate floor, not a quality bar. It rejects empty files and one-line placeholders ("TODO: write this later") without dictating exact format. A reviewer pass catches semantic emptiness; the guard catches the easy case of "didn't write anything."

## Threshold rationale

`MIN_WHY_CONTENT_CHARS = 200` was picked to:

- Reject empty files (0 chars) — would otherwise mask deletion-by-typo
- Reject one-sentence placeholders (~50-100 chars) — the failure mode "I'll come back and write this properly later" that never happens
- Accept any genuine 4-section WHY.md (the project's standard format produces 1500+ chars naturally)

The threshold is tunable via `MIN_WHY_CONTENT_CHARS` at the top of `check-audit-tool-docs.ts`. Raising it makes the floor stricter; lowering it accepts more skeletal docs. Don't lower it below 100 — at that point the guard stops catching anything meaningful.

Frontmatter is stripped before measuring (the body is what counts as documentation). The strip regex accommodates both LF and CRLF line endings.

## Decay check

When this tool's reminder fires:

- Has the registry shrunk to zero entries? The guard is enforcing nothing — either delete it, or treat the empty registry as a signal that the audit system itself has been abandoned.
- Are contributors regularly writing stub WHY.md files just to clear the gate? Either raise `MIN_WHY_CONTENT_CHARS` to force more substantive content, or accept that the floor is doing what it can — quality is a code-review concern, not a structural one.
- Did the project move WHY.md files to a different location convention? Update the registry entries to match.
- Is the guard slow (it shouldn't be — pure file I/O against ~15 paths)? Investigate; the original design was meant to add <1 second to the lint job.

Self-application matters: if `guard:audit-tool-docs` itself drifts into stub status, the guard's own reminder is the prompt to fix or delete. The recursion stops one level deep — there's no meta-meta-guard, and there shouldn't be.
