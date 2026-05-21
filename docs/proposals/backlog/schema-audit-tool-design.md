# Schema Audit Tool — Design

> **Status**: design locked 2026-05-21 via 4-council-model pass (Gemini 3.1 Pro → GLM 5.1 → Kimi K2.6 → Opus 4.7). Implementation in-progress on branch `feat/schema-audit-tool`.
> **Purpose**: find Prisma `?` (optional) columns where `null` is NOT a meaningful application state — a workaround that shipped a 4-month bug previously (`default_persona_id` shell-user-vs-real-user nullability).

## Problem statement

The "Schema Audit for Nullable-That-Isn't FK Columns" theme in `backlog/future-themes.md` calls for an audit. An ad-hoc grep pass on 2026-05-21 produced thin results — both the model and the explore agent reasoned from priors instead of doing systematic per-column evidence work. A repeatable tool is needed.

## Design council pass (2026-05-21)

Four models consulted, each surfaced gaps the others missed. Final synthesis below.

### Where the models converged

- **Use `pnpm ops` command, not ESLint rule** (GLM, Kimi, Opus): schema-audit is an architectural-graph problem, file-scoped tools fight it.
- **JSON core + markdown reporter** (Gemini, all): structured output for CI integration, human-readable derivative for reports.
- **Skip Recipes C (defensive `?? fallback` tracing) and D (wide-union narrowing)** (Gemini, others agreed): cross-function control-flow analysis is a complexity trap.

### Where the models diverged — final calls

**Recipe F (DB query for "no nulls in prod")**:

- Gemini: YES — "data doesn't lie."
- GLM: NO — survivorship bias, temporal false negatives. "No nulls today" means "edge case hasn't fired yet."
- Kimi: NO — lagging indicator, false confidence.
- **Final call: drop Recipe F.** 2-of-3 reject; the empirical-evidence framing was overstated.

**Suppression mechanism**:

- Gemini: `/// @audit-ignore("reason")` triple-slash Prisma schema comments.
- GLM/Kimi: detached `audit.config.ts` with imported Prisma type symbols.
- Opus: schema-qualified string keys (`"User.nsfwVerifiedAt"`) in `audit.config.ts`, validated against the parsed Prisma schema at audit start.
- **Final call: Opus's approach.** Schema comments would trigger Prisma migrations every time someone wants to suppress a finding (operationally toxic). Symbol-import suppression breaks on Prisma client regeneration (fragile). Schema-qualified strings give rename-safety without coupling to generated symbols, validated at startup.

**Recipe shape**:

- Gemini: A + B + E + F (write-focused, with DB verification).
- GLM: "Flip to reads" — find optional fields never defensively accessed, simpler than write-tracing.
- Kimi: "Enforcer not detector" — remove `?` and run tsc, errors are the report.
- Opus: **`??` vs `!= null` read-mode classification + bimodal-writes Recipe 8**.
- **Final call: Opus's design.** It's the only one that distinguishes our two real-world columns (`nsfwVerifiedAt` state machine vs `defaultLlmConfigId` convenience-nullable). GLM's read-only collapses them; Kimi's tsc approach generates noise (`tsc` errors on writes, not the convenience-fallback reads we care about); Gemini's writes-focused misses the read-mode signal entirely.

## Final design

### Tool

`pnpm ops dev:schema-audit` standalone CLI. One-shot run (not CI ratchet — new optional columns are rare; ratchet adds maintenance for low value per Opus). Quarterly or opportunistic invocation.

### Implementation choices

- **TS compiler API directly** (Kimi): raw `ts.createProgram`, not ts-morph. Project already has `typescript` dep; ts-morph adds weight for marginal gain on a focused analysis.
- **Schema parsing**: regex for milestone-1 (simpler), upgrade to `@prisma/internals` `getDMMF()` later if regex hits edge cases (Prisma triple-slash extraction, `@@map` resolution).

### Recipes

**Primary recipe — Read-mode classification** (Opus 4.7's key insight):

For each optional column, walk every TS access in `services/` + `packages/`:

- `field ?? fallback` style → **convenience-nullable** (null has a fallback value)
- `field != null` / `if (field)` truthiness guard → **state machine** (null is a meaningful state)
- Unguarded with `!` / `as` → **fake-optional** (caller assumes presence)

Threshold: if >50% of reads are `??`-style → flag as tightening candidate. If >50% are truthiness guards → state machine, don't flag. If unguarded `!`/`as` dominate → highest severity (silently broken type contract).

**Why this distinguishes the real columns**:

- `users.nsfwVerifiedAt`: guards are `if (user.nsfwVerifiedAt != null)`-style — "have they verified?" question. **NOT flagged.**
- `users.defaultLlmConfigId`: reads are `user.defaultLlmConfigId ?? globalDefault` — fallback to system default. **Flagged for potential tightening.**

**Secondary recipe — Bimodal writes** (Opus 4.7's Recipe 8 — the original 4-month-bug detector):

For each optional column, classify every `.create({ data: {...} })` call site by literal value passed:

- "always literal `null` or omitted" set
- "always a real value" set
- Mixed (neither set dominant)

If sites split cleanly into the first two — bimodal — that's the **shell-user-vs-real-user pattern**. The column encodes caller identity in its nullability. **Flag as high-severity.**

**Tertiary recipe — Refined Recipe A** (defaults-aware):

For each optional column, check if it's always passed in `.create()` AND has no `@default(uuid()|now()|cuid())`. The default-aware exclusion (Kimi's catch) prevents flagging fields where callers SHOULD omit.

### Drops

- **Recipe C** (defensive `?? fallback` tracing): cross-function control flow trap.
- **Recipe D** (wide TS unions): same complexity trap.
- **Recipe E as-stated** ("never written in `.create`/`.update`"): wrongly flags deferred-null state machines like `nsfwVerifiedAt` (GLM's catch).
- **Recipe F** (DB query): survivorship bias (GLM/Kimi).
- **CI ratchet**: low value vs maintenance cost (Opus). New optionals are rare; a PR-template checkbox catches 80%.

### Bootstrap mechanism

Per Opus (reframing Kimi): the "remove the `?` and run `tsc`" approach is a **triage tool for shortlist validation**, not the audit report.

Workflow:

1. Tool produces ranked candidate list.
2. For top candidates, manually remove `?` in schema and run `tsc`.
3. Count error sites. >5 errors = probably state machine (the column is written `null` in many places legitimately). ≤5 = probably real tightening candidate.

### Suppression — `audit.config.ts`

```typescript
// audit.config.ts at project root
export const schemaAuditConfig = {
  suppressions: [
    {
      key: 'User.nsfwVerifiedAt',
      reason: 'state-machine: null until user completes NSFW verification flow',
      reviewedAt: '2026-05-21',
    },
    {
      key: 'PendingMemory.lastAttemptAt',
      reason: 'state-machine: null until first retry attempt',
      reviewedAt: '2026-05-21',
    },
  ],
};
```

**Validation at audit start**:

1. Parse current `prisma/schema.prisma`.
2. For each suppression key (`Model.fieldName`), verify the field exists AND is optional.
3. Fail loudly if a suppressed field is renamed, removed, or already tightened. (Prevents stale suppressions from rotting.)

### Output

**JSON** (structured findings):

```json
{
  "findings": [
    {
      "severity": "HIGH",
      "recipe": "bimodal-writes",
      "model": "User",
      "field": "exampleField",
      "evidence": { "siteA": [...], "siteB": [...] },
      "fixShape": "..."
    }
  ],
  "stats": { "columnsAnalyzed": 52, "flagged": 3, "suppressed": 8 }
}
```

**Markdown** (human report): findings grouped by severity, evidence inline.

## Upstream complement (Opus's "real fix")

> "The real fix is upstream: a code-review rule that every new `?` in `schema.prisma` requires a comment explaining the null semantics."

Ship alongside the tool:

- PR template checkbox: "If this PR adds a new optional (`?`) field to `prisma/schema.prisma`, the field has a comment explaining the null semantics (state machine? default-fallback? deferred-set?)."
- `.claude/rules/03-database.md` addition: convention that every new `?` has a triple-slash explanation.

Both can ship as the first PR — even without the tool, they create the discipline that prevents future occurrences of the original 4-month bug.

## Multi-session milestones

**Milestone 1 (today)**: scaffolding + primary recipe + smoke test

- [ ] Branch `feat/schema-audit-tool` ✓ created
- [ ] Design doc captured (this file) — task in progress
- [ ] Scaffold `pnpm ops dev:schema-audit` command
- [ ] Schema parsing (regex; extract `?` columns + `@default` values + triple-slash docs)
- [ ] Recipe Primary: read-mode classification
- [ ] Markdown output
- [ ] Smoke test against tzurot's schema — must NOT flag `nsfwVerifiedAt`, SHOULD flag `defaultLlmConfigId`/`defaultTtsConfigId`
- [ ] Tests for milestone-1 components

**Milestone 2 (next session)**: secondary recipes + suppression

- [ ] Recipe Secondary: bimodal-writes detection
- [ ] Recipe Tertiary: refined Recipe A (defaults-aware)
- [ ] `audit.config.ts` suppression mechanism with schema validation
- [ ] JSON output mode
- [ ] More tests

**Milestone 3 (cleanup)**: upstream complement + documentation

- [ ] PR template checkbox addition
- [ ] `.claude/rules/03-database.md` convention update
- [ ] User-facing documentation in `docs/reference/tooling/`
- [ ] Delete this design doc (proposal-style, post-merge per `07-documentation.md`)

## References

- `backlog/future-themes.md` → "Schema Audit for Nullable-That-Isn't FK Columns" theme
- Council session 2026-05-21: Gemini 3.1 Pro → GLM 5.1 → Kimi K2.6 → Opus 4.7
- Prior 4-month bug: `default_persona_id` nullable for shell-user creation (closed by Phase 5b identity-hardening epic)
- Two concrete columns this tool must distinguish:
  - `users.nsfwVerifiedAt DateTime?` — state machine (don't flag)
  - `users.defaultLlmConfigId String?` — convenience-nullable (do flag)
