# Why `dev:schema-audit` exists

## What it does

Static-analyzes `prisma/schema.prisma` for columns marked `?` (optional) where `null` is NOT a meaningful application state. Runs four recipes:

- **Primary**: read-site classification — does the codebase guard against `null` reads, or does it assume the field is always set?
- **Secondary**: write-site classification — do any creation paths actually leave the column null, or does every path always set it?
- **Tertiary**: composed findings flagging "fake-optional" columns (nullable for code-convenience reasons, not because null is a real state)
- **Suppression mechanism**: explicit allowlist for columns where the audit is wrong (rare)

Outputs markdown by default; `--format=json` for tooling. Full design doc at `docs/reference/tooling/schema-audit.md`.

## Why it was built

A 4-month-undetected bug shipped in production because `users.default_persona_id` was marked nullable for code-convenience reasons. The pattern: one user-creation path was inconvenient to update at the time, so the column got `?` rather than fixing the upstream path. Months later, an unrelated change relied on `default_persona_id` being non-null. The "always set" assumption broke silently — users created via the old path had nulls that propagated until production-side error reports surfaced them.

The post-mortem (filed at `docs/reference/architecture/epic-identity-hardening.md`) identified the failure mode as not unique to that bug: any `?` field that gets `null` for code-convenience reasons (rather than because null is a meaningful app state) is a latent identical bug. The audit's job is to surface the pattern statically before it ships.

The schema-doc-comment requirement in `.claude/rules/03-database.md` ("Every new `?` field MUST have a triple-slash doc explaining what null means") is the human-side enforcement. The audit is the structural enforcement that catches the same pattern when the human side misses it.

## Threshold rationale

Findings are reported with severity tiers. The audit doesn't hard-fail CI by default — `--strict` flag does. The intent is for findings to be triaged at PR-review time (the PR-template checkbox surfaces them), with the audit-config suppressions used only for columns where the audit is provably wrong.

The four recipe categories were tuned to the actual bug shapes observed during the Phase 5 identity-hardening campaign. New recipes can be added in `schema-audit-findings.ts` when a new failure pattern is observed in the wild.

## Decay check

When this tool's reminder fires:

- Did the schema flatten (no more `?` fields)? The audit becomes a no-op — keep it as a forward-defense.
- Did Prisma add native "this null means X" annotations? Delete the tool — the language now expresses what the audit was deriving.
- Is the suppression list growing unboundedly? That's a smell — investigate whether the audit's classification rules need refining.

The audit's job is to make the fake-optional pattern impossible to introduce silently. Keep it as long as new `?` fields land in the schema.
