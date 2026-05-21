# Schema Audit Tool

> **Command**: `pnpm ops dev:schema-audit`
> **Purpose**: find Prisma `?` (optional) columns where `null` is NOT a meaningful application state — workarounds that ship latent bugs.
> **Status**: ships from `feat/schema-audit-tool` branch; design pass in `docs/proposals/backlog/schema-audit-tool-design.md`.

## Why this tool exists

A 4-month-undetected bug shipped because `users.default_persona_id` was nullable at the DB level not because `null` was meaningful, but because one creation code path (`getOrCreateUserShell`) was inconvenient to fix properly. Phase 5b of the identity-hardening epic closed that specific bug. This tool detects the same _shape_ on other columns — before they ship.

Three council models (Gemini 3.1 Pro → GLM 5.1 → Kimi K2.6 → Opus 4.7) shaped the final design via the council MCP; see the proposal doc for the full synthesis.

## Usage

```bash
# Default — markdown report against ./prisma/schema.prisma + ./services + ./packages
pnpm ops dev:schema-audit

# JSON output (for CI integration / tooling pipelines)
pnpm ops dev:schema-audit --json

# Override the audit config path
pnpm ops dev:schema-audit --config ./custom-audit.config.ts
```

Exit code is non-zero if any findings exist (suitable for one-shot quarterly runs).

## Recipes

The tool implements three recipes. Each gates itself on its own preconditions; multiple recipes can fire on the same field.

### Primary — Read-mode classification

For each optional column, walk every TS `obj.field` access in the source tree and classify the parent context:

| Read pattern                  | Signal               | Threshold to flag |
| ----------------------------- | -------------------- | ----------------- |
| `field ?? fallback`           | Convenience-nullable | >50% of reads     |
| `field != null` / truthiness  | State machine        | (don't flag)      |
| `field!` (non-null assertion) | Fake-optional        | >50% of reads     |

If reads dominate `??` → flag MEDIUM. If reads dominate non-null-assertion → flag HIGH (the TS code asserts presence the schema doesn't enforce).

### Secondary — Bimodal-writes (the original-bug detector)

For each optional column, walk every `prisma.<model>.create({ data })` and `prisma.<model>.upsert({ create })` site. Classify each site:

- **null-literal**: `field: null`
- **value**: `field: <non-null expression>` (including identifiers, calls, etc.)
- **omitted**: field not present in the data object
- **unclassifiable**: object contains spread (`...x`) and field is absent

Recognises common nullable-fallback syntax: `field: x ?? null`, `field: x || null`, `field: x ?? undefined` are all bucketed as `null-literal` (the caller is acknowledging the value may be null at runtime).

If sites split into ≥2 null-or-omit AND ≥2 value clusters → flag HIGH. That's the "caller identity encoded in nullability" pattern — same shape as the `default_persona_id` shell-user-vs-real-user bug.

### Tertiary — Always-passed-no-default

If every site passes a value (no null, no omit) AND the schema has no `@default(uuid()|now()|cuid()|nanoid()|autoincrement()|dbgenerated(...))` generator that would explain why callers might omit — flag MEDIUM. The optionality is unused.

## Suppression — `audit.config.ts` or `.json`

Some nullability is genuinely intentional (state machines, deferred-set columns). Suppress at the project root with a config file:

```typescript
// audit.config.ts
import type { SchemaAuditConfig } from '@tzurot/tooling';

export const schemaAuditConfig: SchemaAuditConfig = {
  suppressions: [
    {
      key: 'User.nsfwVerifiedAt',
      reason: 'state-machine: null until user completes NSFW verification flow',
      reviewedAt: '2026-05-21',
    },
    {
      key: 'PendingMemory.lastAttemptAt',
      reason: 'deferred-set: null on initial insert, populated by retry loop',
      reviewedAt: '2026-05-21',
    },
  ],
};
```

Or as `audit.config.json`:

```json
{
  "suppressions": [
    {
      "key": "User.nsfwVerifiedAt",
      "reason": "state-machine: null until user completes NSFW verification flow",
      "reviewedAt": "2026-05-21"
    }
  ]
}
```

**Validation**: At audit start, every suppression key must resolve to an OPTIONAL field in the current schema. Stale suppressions fail loudly — never silently no-op on a renamed/removed/tightened column. This means: if you tighten a column to NOT NULL and forget to remove its suppression, the next audit run breaks.

## Known limitations (false-positive sources)

The tool produces _candidates_ for human review, not verdicts:

1. **Relation-mediated reads are invisible.** Most Prisma column reads happen via the RELATION (`user.defaultLlmConfig.model`) rather than the ID column (`user.defaultLlmConfigId`). The read-mode recipe only sees direct property accesses, so a column whose primary access pattern is relation-traversal won't classify.
2. **Receiver-name matching is heuristic.** The read-mode recipe matches `<varName>.<field>` by lowercasing the variable name and comparing it to the model name. Variables named `currentUser`, `provisionedUser`, etc. won't match.
3. **`?? null` detection is syntactic, not type-based.** `field: data.foo ?? null` is correctly bucketed as null-yielding, but `field: getThing()` where `getThing` returns `T | null` is not — the static analysis can't introspect the return type.
4. **Test-fixture sites are included by default.** Globs exclude `*.test.ts`/`*.int.test.ts`, but `test-utils.ts` and other helper files contribute to write-site counts. The signal-to-noise ratio is acceptable on the current codebase, but a project with many fixtures should look at the resulting findings critically.
5. **Schema parsing is regex-based.** Edge cases that may produce wrong field metadata: `@@map` directives, multi-line field attributes, complex composite types. Upgrade path: `@prisma/internals` `getDMMF()`.
6. **No DB-level cross-check.** Some council models suggested querying production data (`SELECT COUNT(*), COUNT(column) FROM table`). The tool deliberately doesn't — "no nulls in prod" is survivorship bias (the edge case hasn't fired yet). Use `ALTER COLUMN SET NOT NULL` migrations for empirical enforcement; not this tool.

## Upstream complement — preventing fake-optionality at write time

The tool catches drift. The complement, per `.claude/rules/03-database.md` "Optional Columns Require Null-Semantics Documentation", catches introduction:

- **PR template checkbox** in `.github/pull_request_template.md` flags any PR adding a new `?` field and requires the contributor to confirm the field has a null-semantics comment.
- **Triple-slash convention** in the rule file documents the four canonical patterns (state machine / default-fallback / deferred-set / state-machine-by-status). New optional columns should pick a pattern and document accordingly.

Combined, the goal is to make a "fake-optional" column impossible to introduce silently. Existing fake-optionals are caught by the audit; new ones are caught by the PR review process.

## Operational expectations

- **One-shot quarterly run**, not a CI ratchet. New optional columns are rare events; the maintenance cost of a ratchet exceeds the value (per Opus 4.7's design call).
- **Findings are candidates**, not auto-fixes. Each finding requires human judgment about whether the optionality is genuinely intentional.
- **Suppression files DO live in version control.** A new contributor running the audit gets the same results as the maintainer.

## Design references

- Proposal doc: [`docs/proposals/backlog/schema-audit-tool-design.md`](../../proposals/backlog/schema-audit-tool-design.md) — full 4-council-model synthesis
- Source modules: `packages/tooling/src/dev/schema-audit*.ts`
- Tests: `packages/tooling/src/dev/schema-audit.test.ts`
- Rule: [`.claude/rules/03-database.md`](../../../.claude/rules/03-database.md) — "Optional Columns Require Null-Semantics Documentation"
