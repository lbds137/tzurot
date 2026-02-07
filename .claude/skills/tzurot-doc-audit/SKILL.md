---
name: tzurot-doc-audit
description: 'Documentation freshness audit. Invoke with /tzurot-doc-audit to review docs for staleness, missing tools, and inconsistencies.'
lastUpdated: '2026-02-07'
---

# Documentation Audit Procedure

**Invoke with /tzurot-doc-audit** to audit documentation freshness across the project.

Run this periodically (e.g., after adding new tools, after major refactors) to ensure docs stay accurate.

## Audit Checklist

Work through each section. For each item, verify accuracy and fix inline or note for follow-up.

### 1. Rules Files (`.claude/rules/`)

| File                   | Check                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| `00-critical.md`       | Security rules still reflect current patterns? Post-mortem table current?       |
| `01-architecture.md`   | Service boundaries match dependency-cruiser rules? Anti-patterns table current? |
| `02-code-standards.md` | ESLint limits match `eslint.config.js`? Testing patterns current?               |
| `03-database.md`       | Cache implementations table accurate? Protected indexes list current?           |
| `04-discord.md`        | Shared utilities table lists all browse/dashboard helpers?                      |
| `05-tooling.md`        | All `pnpm ops` commands listed? `pnpm quality` description accurate?            |
| `06-backlog.md`        | Backlog structure matches actual BACKLOG.md sections?                           |

**How to verify 05-tooling.md:**

```bash
pnpm ops --help          # Compare available commands vs documented ones
pnpm quality --help      # Verify quality script description
```

### 2. Static Analysis (`docs/reference/STATIC_ANALYSIS.md`)

- [ ] All tools in `pnpm quality` are documented
- [ ] dependency-cruiser rules match `.dependency-cruiser.cjs`
- [ ] knip config notes match `knip.json`
- [ ] "Target State" table reflects current blocking/non-blocking status
- [ ] CI integration section matches `.github/workflows/ci.yml`

### 3. OPS CLI Reference (`docs/reference/tooling/OPS_CLI_REFERENCE.md`)

- [ ] Every `pnpm ops` subcommand is documented
- [ ] Command options are accurate (compare with actual `--help` output)
- [ ] Package.json shortcuts table matches root `package.json` scripts

**How to verify:**

```bash
pnpm ops --help          # List all registered commands
# Compare with documented commands in OPS_CLI_REFERENCE.md
```

### 4. Tooling README (`packages/tooling/README.md`)

- [ ] Architecture diagram matches actual directory structure
- [ ] Usage examples work when copy-pasted
- [ ] Dependencies list is current

### 5. Skill Files (`.claude/skills/`)

For each skill:

- [ ] `lastUpdated` date is recent (within 30 days of last relevant code change)
- [ ] Procedures still work as written
- [ ] Referenced files/paths still exist
- [ ] Commands produce expected output

**Skills to check:**

```bash
ls .claude/skills/*/SKILL.md
```

### 6. Root CLAUDE.md

- [ ] Version number in commands section is current
- [ ] Rules descriptions match actual rule file contents
- [ ] Post-mortem table includes recent incidents

### 7. Cross-Reference Checks

These catch drift between docs and code:

| What                                    | Compare                                   |
| --------------------------------------- | ----------------------------------------- |
| Architecture rules (01-architecture.md) | `.dependency-cruiser.cjs` forbidden rules |
| Quality command description             | Root `package.json` `quality` script      |
| CI steps                                | `.github/workflows/ci.yml` job steps      |
| Pre-push checks                         | `.husky/pre-push` numbered steps          |
| Package.json shortcuts                  | `OPS_CLI_REFERENCE.md` shortcuts table    |

## After Audit

1. Fix issues found inline during the audit
2. Update `lastUpdated` on any modified skill files
3. Note any larger doc rewrites needed in BACKLOG.md Inbox
4. Commit documentation fixes: `docs: audit and refresh documentation`

## References

- Documentation philosophy: `docs/reference/DOCUMENTATION_PHILOSOPHY.md`
- Session docs skill: `.claude/skills/tzurot-docs/SKILL.md`
