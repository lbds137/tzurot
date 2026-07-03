# Audit-Enforcement Reference

How tzurot's audit tools stay alive, get validated, and detect their own decay. This is the operator/contributor reference for the system, including the design rationale (see "Design rationale" below — the original proposal doc was folded in and deleted once the system shipped).

## What "audit-class" means

A `pnpm ops` command is an **audit tool** when it:

1. Reports a code-quality or data-quality measurement
2. Runs periodically (CI, pre-commit, or manual periodic invocation)
3. Has a threshold that decides pass/fail or warn/info

Diagnostic tools that are user-invoked for inspection (`inspect:queue`, `inspect:dlq`, `inspect:tts-configs`, `xray --print-config`) are **not** audit tools — they don't have a threshold or a pass/fail verdict; they're shells for ad-hoc operator queries.

`memory:analyze` is a borderline case: it has a measurement (duplicate memories) but is one-shot remediation, not a periodic audit. It's intentionally **not** registered in `AUDIT_TOOL_REGISTRY` even though it has a `WHY.md`.

## The registered audit tools (15)

Single source of truth: [`packages/tooling/src/audits/audit-tool-registry.ts`](../../packages/tooling/src/audits/audit-tool-registry.ts).

| Command                        | Implementation                                             | What it gates                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lint:complexity-report`       | `packages/tooling/src/lint/complexity-report.ts`           | ESLint max-\* rule findings at 80% of hard limits                                                                                                      |
| `db:check-safety`              | `packages/tooling/src/db/check-migration-safety.ts`        | Migrations don't drop protected indexes                                                                                                                |
| `db:check-drift`               | `packages/tooling/src/db/check-migration-drift.ts`         | Migration file checksums match the `_prisma_migrations` table                                                                                          |
| `guard:proposal-links`         | `packages/tooling/src/audits/check-proposal-orphans.ts`    | Every `docs/proposals/backlog/*.md` has an inbound link                                                                                                |
| `guard:boundaries`             | `packages/tooling/src/dev/check-boundaries.ts`             | Service-boundary import rules — `--summary` wired (runs in the `ops health` roster); no canary yet (the remaining Layer 1 gap for this tool)           |
| `guard:audit-tool-docs`        | `packages/tooling/src/audits/check-audit-tool-docs.ts`     | Every registered audit tool has a non-stub WHY.md                                                                                                      |
| `cpd:filtered`                 | `packages/tooling/src/commands/cpd.ts`                     | Filtered duplication ratchet with drift detection (companion commands: `cpd:check`, `cpd:update-baseline` — only `cpd:filtered` is the registry entry) |
| `dev:schema-audit`             | `packages/tooling/src/dev/schema-audit.ts`                 | Prisma `?` fields with non-null-meaningful semantics                                                                                                   |
| `dev:dead-files` (`knip:dead`) | `packages/tooling/src/dev/find-dead-files.ts`              | Production files imported only by their own tests                                                                                                      |
| `test:audit`                   | `packages/tooling/src/test/audit-unified.ts`               | Service + contract test coverage ratchet with drift detection                                                                                          |
| `mutation:check`               | `packages/tooling/src/test/mutation-check.ts`              | Mutation-score ratchet over Stryker reports (per-package floors, drift-detected)                                                                       |
| `voice-refs:audit`             | `packages/tooling/src/voice/audit-references.ts`           | Voice reference durations vs Mistral 30s cap                                                                                                           |
| `xray`                         | `packages/tooling/src/xray/`                               | Monorepo structural report + lint-suppression audit                                                                                                    |
| `guard:claude-content-refs`    | `packages/tooling/src/audits/check-claude-content-refs.ts` | `.claude/` content references resolve (no dangling `pnpm ops` command refs)                                                                            |
| `commands:audit`               | `packages/tooling/src/dev/commandsAudit.ts`                | Slash-command manifest integrity (categories, descriptions, handler completeness)                                                                      |

Each command's WHY.md is at the path `<implementation>.WHY.md` (or `WHY.md` if the implementation is a directory). The four-section template is: **What** / **Why** / **Threshold rationale** / **Decay check**.

## The three structural enforcement layers

### Layer 1 — Canary tests (validate the tools work)

Every audit tool that has emitted a JSONL `--summary` line has a **canary test** in `packages/tooling/src/audits/canary.test.ts`. The canary runs the tool against a deliberate-violation fixture in `packages/tooling/test-fixtures/audit-canaries/<tool>/` and asserts the tool reports `status: 'fail'` with findings > 0.

Canary fixtures are intentionally broken — `known-complex.js` has cyclomatic complexity 25 (over the 20 limit), `db-check-safety/0001_drops_protected_index/migration.sql` drops `idx_memories_embedding` without recreating, etc. The fixture comments contain explicit "DO NOT FIX / DO NOT REMOVE" warnings.

**Adding a new audit tool**: write its canary fixture and canary test BEFORE shipping. The canary is what catches "tool was working in March, then a dep bump broke it silently."

### Layer 2 — `WHY.md` per audit tool + `guard:audit-tool-docs`

Every registered audit tool has a colocated `WHY.md`. The `guard:audit-tool-docs` command hard-fails CI when:

- A registered tool's WHY.md is missing
- A registered tool's WHY.md is below the 200-character non-frontmatter body threshold (empty / stub / "TODO: write this" placeholder)
- A `*.WHY.md` file exists in `packages/tooling/src/` with no matching registry entry AND no `UNREGISTERED_WHY_PATHS` allowlist entry (bidirectional check)

The `UNREGISTERED_WHY_PATHS` allowlist in the registry file is the escape hatch for WHY.md files that document non-audit-class tools (currently just `cleanup-duplicates.WHY.md` for `memory:analyze`).

`guard:audit-tool-docs` self-registers — its own WHY.md is subject to its own check. The recursion stops one level deep.

### Layer 3 — Baseline meta + drift detection

Tools with a baseline file carry a `meta` block in the baseline JSON:

```json
{
  "filteredLines": 1718,
  ...
  "meta": {
    "toolVersion": "cpd-check/1.0",
    "configHash": "a7f4e5150567",
    "nodeVersion": "v24.11.1",
    "generatedFromSha": "5faa8f92bc4056b585a64ad8409ab0fb29df6942",
    "generatedAt": "2026-05-23T02:58:20.257Z"
  }
}
```

`configHash` is the **only** drift gate. The other fields (`toolVersion`, `nodeVersion`, `generatedFromSha`, `generatedAt`) are recorded for diagnostics — when did this baseline get captured, against what tooling, on what code — but they are NOT part of the `configHash` and don't trigger drift detection. A Node version bump alone does not invalidate baselines; only measurement-affecting config changes do.

Each tool defines a `getConfigFingerprint()` that returns the measurement-affecting config slice (thresholds, implementation version, etc.). `hashConfigSlice` produces a stable 12-char SHA-256 from the slice. When the stored hash doesn't match the current hash, the tool hard-fails with:

```
❌ CPD baseline meta drift: configHash drift: baseline=a7f4e5150567 current=xxxxxxxxxxxx
   The baseline was captured under different CPD config. Run `pnpm ops cpd:update-baseline` to refresh.
```

The drift gate forces an intentional refresh whenever the measurement rules change. Without it, a heuristic tweak silently makes every subsequent baseline comparison meaningless.

**Currently drift-detected**: `cpd:check`, `test:audit`. Other audit tools don't have baselines yet; if they gain one, they should adopt the same meta-block pattern.

## Adding a new audit tool

When you build a new audit-class tool (something that reports a measurement with a pass/fail threshold and runs in CI), do these in order:

1. **Build the tool** with a pure function for testability and a thin CLI wrapper. Mirror the structure of `check-proposal-orphans.ts` (pure `findProposalOrphans()` + CLI `checkProposalOrphans()`).
2. **Add a `--summary` mode** that emits exactly one JSONL line via `audits/summary.ts:emitSummary()`. This is the contract the future aggregator parses.
3. **Write the WHY.md** at `<implementation>.WHY.md`. Four sections: What / Why / Threshold rationale / Decay check. Substantive enough to clear the 200-char content threshold — don't ship a stub.
4. **Register in `AUDIT_TOOL_REGISTRY`** in `audit-tool-registry.ts`. Add the command name, WHY.md path, and one-line description.
5. **Write the canary fixture + test** (requires `--summary` mode from step 2 — see Layer 1). Put the fixture in `packages/tooling/test-fixtures/audit-canaries/<tool>/`. The canary test in `canary.test.ts` invokes the tool with `summary: true` against the fixture and asserts `status: 'fail'`, `findings > 0`. Fixture file MUST have a "DO NOT FIX / DO NOT REMOVE" comment.
6. **Wire into CI** in `.github/workflows/ci.yml` lint job (or wherever appropriate for the tool's cadence).
7. **If the tool has a baseline**: define `getConfigFingerprint()` and an `IMPL_VERSION` constant; the baseline write path calls `buildBaselineMeta()` and the check path calls `checkMetaDrift()`. Mirror the CPD or test:audit pattern.

The canary test running green in CI proves the tool actually detects what it claims to.

## Refreshing baselines

Baselines drift when:

- The tool's measurement-affecting config changes (threshold, rule set, heuristic implementation)
- The underlying codebase legitimately moves the metric (a refactor reduced duplication; a new feature added some)

To refresh:

```bash
pnpm ops cpd:update-baseline           # CPD
pnpm ops test:audit --update           # test-coverage
```

Both write a fresh `meta` block on refresh, so the new `configHash` reflects the current config. If you're refreshing because the tool's implementation version bumped (`FILTER_IMPL_VERSION` or `TEST_AUDIT_IMPL_VERSION`), the refresh is the _only_ path that restores CI green — drift detection will fail every other invocation until the meta is current.

**Don't bypass the ratchet by editing the baseline by hand.** The refresh command is the sanctioned path; it writes the correct meta block, preserves the `notes` field, and runs the full measurement. Hand-edits skip these and produce subtle staleness.

## Where to find what

- **Adding a new audit tool**: this doc, "Adding a new audit tool" section above
- **Architectural rationale**: "Design rationale" section below
- **WHY.md template**: copy any existing one (they all use the same 4-section structure); see [`packages/tooling/src/lint/complexity-report.WHY.md`](../../packages/tooling/src/lint/complexity-report.WHY.md) for a fully-fleshed example
- **JSONL summary shape**: [`packages/tooling/src/audits/summary.ts`](../../packages/tooling/src/audits/summary.ts) — the `AuditSummary` interface is the contract
- **Canary test pattern**: [`packages/tooling/src/audits/canary.test.ts`](../../packages/tooling/src/audits/canary.test.ts) — read existing tests before writing a new one
- **Registry**: [`packages/tooling/src/audits/audit-tool-registry.ts`](../../packages/tooling/src/audits/audit-tool-registry.ts)
- **Baseline meta helpers**: [`packages/tooling/src/audits/baseline-meta.ts`](../../packages/tooling/src/audits/baseline-meta.ts)

## Layer 5 — the `ops health` aggregator + weekly cron (SHIPPED)

`pnpm ops health` (root shortcut `pnpm ops:health`) runs every roster tool as
a real `pnpm ops <tool> --summary` subprocess, parses each JSONL summary line,
and prints one consolidated report. The roster is the static `HEALTH_TOOLS`
const in [`packages/tooling/src/audits/health.ts`](../../packages/tooling/src/audits/health.ts) —
criteria: summary-capable AND meaningful on a bare argument-less run (tools
whose bare run is perma-red, like `lint:complexity-report` and
`db:check-safety`, are excluded with tuning follow-ups in
`backlog/cold/follow-ups.md`). A tool emitting a `fail` summary is a finding;
a tool emitting no parseable line is BROKEN and fails the aggregate loudly —
silent tool rot is the failure mode the system exists to catch.

`.github/workflows/weekly-audit.yml` runs it every Saturday 09:00 UTC (from
the default branch — scheduled workflows only fire there) and posts the report
to Discord via the out-of-band `DISCORD_AUDIT_WEBHOOK_URL` secret — never
through the bot, which is itself the system under audit. Missing secret
degrades to log-only; the audit never skips.

## Design rationale — rejected alternatives (don't re-litigate)

From the council pass that produced this system. The core insight: on a solo project, audit systems die of mutedness, not absence — every choice below optimizes for "still being read at month 6."

| Rejected design                                        | Why                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Centralized audit ledger (`.tzurot/audit-ledger.json`) | Branches + concurrent runs = JSON merge conflicts on timestamps. Git history IS the ledger (Actions API for run times, git log for baseline ages).                             |
| Auto-ratchet on improvements                           | A silently-broken tool reporting 0 findings would auto-lower the baseline to 0, destroying the signal. Baselines move only via explicit human commit with a one-line why.      |
| UserPromptSubmit hook for overdue-audit reminders      | Token spend + latency on every prompt; a 2 AM prod bug doesn't need schema-drift reasoning competing for context.                                                              |
| Monthly maintenance PR (auto-opened)                   | Solo-dev PR queues become graveyards; by day 20 you force-push without reading. The CI age-gate is the same forcing function with less ceremony.                               |
| Discord bot as notification channel                    | The bot IS the system under audit — when it's down (exactly when alerts matter), the channel is dead. Out-of-band webhook from the Action instead.                             |
| Escalation ladder (post → DM → CI block)               | DEFERRED, not rejected: solo dev has no audience to perform urgency for, and loud failure trains muting. Re-evaluate at month 3 only if attention is genuinely the bottleneck. |
| Activity-based invalidation (file-hash only)           | Collapses the "assure me nothing bitrotted in 3 idle months" case. Adopted as an overlay: time cadence default, file-hash early-trigger.                                       |
| Smart orchestrator (run only "due" audits)             | With ~5s total runtime, conditional execution is premature optimization. The dumb run-everything aggregator is debuggable half-asleep.                                         |

**Month-3 evaluation questions** (filed in `backlog/cold/follow-ups.md`, due ~2026-10): (1) are the weekly Discord summaries being read — if not, delete the system rather than add pressure; (2) which tools surfaced real findings vs. always-green noise (prune the roster); (3) actual configHash-mismatch frequency (threshold sanity); (4) did any canary catch a real breakage; (5) did the deferred auto-fix-branch idea become relevant.

## What's NOT yet shipped

- **Layer 4 — Markdown baselines**: the proposal originally drafted converting baselines from JSON to markdown for diff-readability. Deferred — JSON + meta block delivers the drift-detection invariant; the markdown migration is independent and probably skippable.
- **The 45-day CI age-gate + month-3 evaluation**: enforcement that the weekly audit actually keeps running (age from the GitHub Actions run history, not a file), and the pruning pass over always-green roster tools. Both deliberately wait on a few months of weekly runs to evaluate against.

If you're working on either, this doc (including the design-rationale section) is the starting context.
