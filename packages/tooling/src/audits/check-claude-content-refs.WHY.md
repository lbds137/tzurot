# Why `guard:claude-content-refs` exists

## What it does

Walks `.claude/rules/*.md` and `.claude/skills/*/SKILL.md`, extracts every `pnpm ops <command>` reference, and asserts each `<command>` is registered in the actual `pnpm ops` CLI. Hard-fails CI on any dangling reference (markdown says `pnpm ops X` but `X` doesn't exist).

Also emits a non-blocking warning when a file's `lastUpdated` frontmatter is older than 180 days. Warning, not hard-fail — staleness is informational; the operator decides whether the content is genuinely stable or needs review.

The valid-command set comes from spawning `pnpm ops --help` and parsing the CAC help output. That way the audit always sees the same command set users do interactively.

## Why it was built

Tzurot's `.claude/rules/` and `.claude/skills/` files are procedural documentation consumed by LLM sessions and humans. They reference `pnpm ops` commands extensively — but nothing structurally checked that the references stayed in sync with the actual CLI. The discovery pass that motivated this tool (during PR #1085) found:

- `OPS_CLI_REFERENCE.md` pointing at a `tzurot-tooling` skill that doesn't exist
- Multiple skills with `lastUpdated` timestamps 100+ days old
- A coordinated effort (PRs #1082-1084) added 5+ new audit commands; the existing skills referenced none of them

The bigger failure mode: when a `pnpm ops <command>` is renamed or removed in code, the markdown reference goes stale silently. A future LLM session reading the skill would invoke a command that no longer exists and waste cycles debugging. Structural enforcement here forces the same level of rigor that `guard:proposal-links` and `guard:audit-tool-docs` apply elsewhere.

## Threshold rationale

**Dangling refs**: zero tolerance. Any `pnpm ops X` in a tracked rule/skill must resolve to a registered command. If `X` is intentionally renamed, the markdown should be updated in the same commit; CI catches when it isn't.

**Staleness threshold (180 days)**: long enough that genuinely stable docs don't get flagged on every push (CLAUDE.md hasn't materially changed in 18 months, that's fine), short enough that drift is caught before it accumulates beyond the next release cycle. Tunable via `STALE_THRESHOLD_DAYS` at the top of `check-claude-content-refs.ts`.

The staleness check is paired with a pre-commit hook that auto-bumps `lastUpdated` to today's date whenever a rule or skill file is edited. Without the hook, the staleness signal would be unreliable — contributors edit files without remembering to bump the frontmatter. With the hook, the timestamp accurately reflects "when the file was last actually touched."

## Decay check

When this tool's reminder fires:

- Did the project move skills to a different location? Update `SCAN_DIRS`.
- Is the `pnpm ops --help` output format different (CAC version bump)? Update `parseRegisteredCommands` to match the new shape.
- Are stale warnings producing more noise than signal? Either raise the threshold or audit each warning and bump the underlying `lastUpdated` after review.
- Did the project drop the `pnpm ops` CLI convention? Delete the tool — there's nothing left to check.

This tool is paired with the auto-bump pre-commit hook. If you're keeping the tool, keep the hook; if you delete the hook, the staleness warning becomes meaningless (timestamps never get bumped, every file looks stale forever).
