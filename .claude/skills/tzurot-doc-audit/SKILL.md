---
name: tzurot-doc-audit
description: 'Documentation freshness audit. Invoke with /tzurot-doc-audit to review docs for staleness, missing tools, and inconsistencies.'
lastUpdated: '2026-02-07'
---

# Documentation Audit Procedure

**Invoke with /tzurot-doc-audit** to audit documentation freshness across the project.

Run this periodically (e.g., after adding new tools, after major refactors) to ensure docs stay accurate.

Standards live in `.claude/rules/07-documentation.md`. This skill is the verification procedure.

## Quick Scan

Fast triage before a full audit:

```bash
# What docs exist?
find docs/ -name '*.md' | sort

# Recent changes (last 30 days)?
git log --since="30 days ago" --name-only --pretty=format: -- docs/ | sort -u | grep .

# Proposals that might be stale?
ls docs/proposals/active/

# Skills lastUpdated dates
grep -r 'lastUpdated' .claude/skills/*/SKILL.md
```

## Audit Checklist

Work through each section. For each item, verify accuracy and fix inline or note for follow-up.

### 1. docs/README.md Index

- [ ] Files listed under "Active proposals" match actual `docs/proposals/active/` contents
- [ ] Files listed under "Backlog proposals" are a representative subset of `docs/proposals/backlog/`
- [ ] Quick Links point to files that exist
- [ ] Reference subdirectory table matches actual subdirectories
- [ ] Root-level documentation section references correct filenames

### 2. Rules Files (`.claude/rules/`)

| File                   | Check                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| `00-critical.md`       | Security rules still reflect current patterns? Post-mortem table current?       |
| `01-architecture.md`   | Service boundaries match dependency-cruiser rules? Anti-patterns table current? |
| `02-code-standards.md` | ESLint limits match `eslint.config.js`? Testing patterns current?               |
| `03-database.md`       | Cache implementations table accurate? Protected indexes list current?           |
| `04-discord.md`        | Shared utilities table lists all browse/dashboard helpers?                      |
| `05-tooling.md`        | All `pnpm ops` commands listed? `pnpm quality` description accurate?            |
| `06-backlog.md`        | Backlog structure matches actual BACKLOG.md sections?                           |
| `07-documentation.md`  | Placement table covers all `docs/reference/` subdirs? Lifecycle rules current?  |

**How to verify 05-tooling.md:**

```bash
pnpm ops --help          # Compare available commands vs documented ones
pnpm quality --help      # Verify quality script description
```

### 3. Skill Files (`.claude/skills/`)

For each skill:

- [ ] `lastUpdated` date is recent (within 30 days of last relevant code change)
- [ ] Procedures still work as written
- [ ] Referenced files/paths still exist
- [ ] Commands produce expected output

```bash
ls .claude/skills/*/SKILL.md
```

### 4. Reference Docs by Subdirectory

| Subdirectory    | Key checks                                                                      |
| --------------- | ------------------------------------------------------------------------------- |
| `architecture/` | ADRs reference current service names? Memory/context docs match implementation? |
| `caching/`      | Pub/sub guide matches actual cache invalidation code?                           |
| `database/`     | Prisma drift issues still relevant?                                             |
| `deployment/`   | Railway operations match current deploy process?                                |
| `features/`     | Feature docs describe current behavior?                                         |
| `guides/`       | Development setup works? Testing guide current?                                 |
| `operations/`   | Runbooks reference correct commands/services?                                   |
| `standards/`    | Patterns still used? No deprecated approaches?                                  |
| `templates/`    | Templates produce valid output?                                                 |
| `testing/`      | Test procedures reference current tools?                                        |
| `tooling/`      | OPS CLI reference matches `pnpm ops --help`?                                    |
| Root files      | `STATIC_ANALYSIS.md` matches CI config? CLI references current?                 |

### 5. Proposals Lifecycle

- [ ] All `proposals/active/` items are actually being worked on (check BACKLOG.md)
- [ ] No completed features still have active proposals (should be deleted)
- [ ] Backlog proposals still relevant (not implemented, not abandoned)

### 6. Research Notes

- [ ] Files in `docs/research/` are TL;DR format (2-5KB, not raw transcripts)
- [ ] No raw AI chat dumps (distill or delete)
- [ ] Research links to actionable items in BACKLOG.md or proposals

### 7. Migration Docs

- [ ] Active migrations in `docs/migration/` are still in progress
- [ ] Completed migrations deleted (feature documented in reference instead)
- [ ] Migration steps still reference correct tools/schemas

### 8. Incidents

- [ ] `docs/incidents/PROJECT_POSTMORTEMS.md` entries match CLAUDE.md post-mortem table
- [ ] Recent incidents are documented
- [ ] Lessons learned are captured in relevant rules

### 9. Other Docs

| Directory          | Check                                                    |
| ------------------ | -------------------------------------------------------- |
| `docs/steam-deck/` | Setup guides still accurate for current SteamOS version? |
| `docs/testing/`    | Not duplicating `docs/reference/testing/`?               |

### 10. Root README.md

- [ ] Project structure lists all packages in `packages/`
- [ ] Architecture diagram matches actual services
- [ ] Slash commands list matches actual commands in `services/bot-client/src/commands/`
- [ ] Quick Start prerequisites are current (Node version, tools)
- [ ] Documentation links point to files that exist
- [ ] Planned features section is accurate (none secretly implemented)

### 11. Root CLAUDE.md

- [ ] All rules listed in Key Rules section (check `ls .claude/rules/`)
- [ ] Rules descriptions match actual rule file contents
- [ ] `pnpm quality` description matches root `package.json` script
- [ ] Post-mortem table includes recent incidents
- [ ] Project structure is accurate

### 12. Cross-Reference Checks

These catch drift between docs and code:

| What                                    | Compare                                   |
| --------------------------------------- | ----------------------------------------- |
| Architecture rules (01-architecture.md) | `.dependency-cruiser.cjs` forbidden rules |
| Quality command description             | Root `package.json` `quality` script      |
| CI steps                                | `.github/workflows/ci.yml` job steps      |
| Pre-push checks                         | `.husky/pre-push` numbered steps          |
| Package.json shortcuts                  | `OPS_CLI_REFERENCE.md` shortcuts table    |
| Documentation placement table (07)      | Actual `docs/reference/` subdirectories   |
| Cache implementations (03-database.md)  | Actual cache classes in codebase          |

## After Audit

1. Fix issues found inline during the audit
2. Update `lastUpdated` on any modified skill files
3. Note any larger doc rewrites needed in BACKLOG.md Inbox
4. Commit documentation fixes: `docs: audit and refresh documentation`

## References

- Documentation standards: `.claude/rules/07-documentation.md`
- Documentation philosophy: `docs/reference/DOCUMENTATION_PHILOSOPHY.md`
- Session docs skill: `.claude/skills/tzurot-docs/SKILL.md`
