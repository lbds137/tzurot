---
name: tzurot-doc-audit
description: 'Documentation and auto-memory freshness audit. Invoke with /tzurot-doc-audit to review docs and Claude auto-memory for staleness, items in the wrong layer, and missing-tool drift.'
lastUpdated: '2026-04-11'
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

# What auto-memory entries exist? (Section 0 covers these — skip if
# this returns "No such file or directory" on a fresh install)
ls ~/.claude/projects/*tzurot*/memory/

# Recent changes (last 30 days)?
git log --since="30 days ago" --name-only --pretty=format: -- docs/ .claude/rules/ .claude/skills/ | sort -u | grep .

# Proposals that might be stale? (project uses backlog/ — no active/ dir by design)
ls docs/proposals/backlog/

# Skills lastUpdated dates
grep -r 'lastUpdated' .claude/skills/*/SKILL.md
```

## Audit Checklist

Work through each section. For each item, verify accuracy and fix inline or note for follow-up.

**Section 0 runs FIRST** because memory entries that migrate to other layers (rules, docs, skills) will affect those sections' audits later.

### 0. Auto-Memory Audit (run FIRST)

Claude's auto-memory in `~/.claude/projects/*tzurot*/memory/` accumulates per-session knowledge that may belong in more durable, team-visible layers. Each memory file is catalogued in `~/.claude/projects/*tzurot*/memory/MEMORY.md` (the index Claude reads at session start). Audit all entries before moving on — items that migrate to rules/docs/skills affect those layers' audits in later sections.

```bash
# Skip this section if the memory directory doesn't exist (fresh install,
# different machine) — there's nothing to audit. The 2>/dev/null + ||
# fallback turns the bash glob-expansion error into a friendly skip
# signal so a copy-paster sees clean output.
ls ~/.claude/projects/*tzurot*/memory/ 2>/dev/null \
  || echo "(no memory directory found — skip Section 0)"

# If the glob silently expands to nothing (different checkout path),
# find the project directory manually:
ls ~/.claude/projects/ 2>/dev/null | grep -i tzurot \
  || echo "(no tzurot project directory found in ~/.claude/projects/)"
```

#### How to classify each memory file

Read each file and pick the matching trigger first — these are the heuristics for choosing a verdict in the table below:

- **Memory content already exists verbatim in a rule/doc/skill** → **Delete** (no migration needed; this is the steady-state outcome — once the initial backlog is cleared, most future audits hit this case)
- Memory references a constraint that's now enforced by a rule → **Delete** (it's redundant)
- Memory describes a multi-step procedure → **Migrate to `.claude/skills/`** (skill candidate)
- Memory captures a one-time investigation finding → **Migrate to `docs/research/`** if distilled to TL;DR, or **Delete** if used and outdated
- Memory describes "always do X for this project" → **Migrate to `.claude/rules/`** (rule candidate)
- Memory describes "this user prefers X" or time-bound state → **Keep in memory** (per-user context, not generalizable)

#### Verdict table

| Verdict                          | Action                                                                                                                                                                                                         | When                                                                                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep in memory**               | No action                                                                                                                                                                                                      | Per-user context (e.g., user's recovery period), working-preference feedback that doesn't generalize to "always do X," time-bound project state (e.g., a deadline), or anything that's volatile or specific to one person's view of the project |
| **Migrate to `.claude/rules/`**  | **Verify the target rule already covers, or will cover, the full intent — including any edge cases the memory captures.** Then: add content to the rule file, delete the memory file, update `MEMORY.md` index | Constraint that should apply to every session and every developer ("the rule"). Driving example: `feedback_out_of_scope_tracking.md` → `06-backlog.md` (Session 1)                                                                              |
| **Migrate to `docs/reference/`** | **Verify the target doc captures the full intent — nuance, examples, exceptions.** Then: create or extend the reference doc, delete the memory file, update `MEMORY.md` index                                  | Persistent technical reference (architecture decision, runbook, design rationale)                                                                                                                                                               |
| **Migrate to `.claude/skills/`** | **Verify the target skill captures the full intent.** Then: create or extend the skill, delete the memory file, update `MEMORY.md` index                                                                       | Procedural knowledge ("how to do X") that should be invocable as a procedure                                                                                                                                                                    |
| **Delete**                       | Remove the memory file, remove from `MEMORY.md` index                                                                                                                                                          | Stale, no longer relevant, redundant with content already captured elsewhere, or describes a one-time investigation that's been resolved                                                                                                        |

The "verify target covers full intent" step in the three migrate verdicts is load-bearing: a memory entry often has nuance (a specific exception, a concrete failure case) that the destination file doesn't yet cover. If you delete the memory before the destination has the nuance, the nuance is gone. Either extend the destination first, or downgrade the verdict to **Keep** until the destination is updated.

After processing each file, the order matters — for migrate verdicts especially, do these steps in sequence:

1. **Write to the destination layer first** (rule, doc, or skill — verifying it captures the full intent of the memory entry)
2. **Delete the memory file**
3. **Update `MEMORY.md`** (the index) to remove deleted entries and revise descriptions for any that changed

Doing them out of order risks orphaning the memory's nuance: if you delete the memory file before the destination has the content, the nuance is gone (the verdict table's bold "Verify the target..." callouts above guard against this).

Auto-memory audit runs as part of the recurring `/tzurot-doc-audit` cycle — there is no separate backlog item to track. If this section grows expensive enough to warrant its own cadence (e.g., audited weekly, while docs are quarterly), split it out then.

### 1. docs/README.md Index

- [ ] Files listed under "Backlog proposals" are a representative subset of `docs/proposals/backlog/`
- [ ] Quick Links point to files that exist
- [ ] Reference subdirectory table matches actual subdirectories
- [ ] Root-level documentation section references correct filenames

> Note: this project uses `BACKLOG.md` (root index) + `backlog/*.md` (per-section) for active work tracking, not `docs/proposals/active/` — that directory does not exist by design. If you see references to it in any doc, they're stale and should be removed.

### 2. Rules Files (`.claude/rules/`)

| File                   | Check                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `00-critical.md`       | Security rules still reflect current patterns? Post-mortem table current?           |
| `01-architecture.md`   | Service boundaries match dependency-cruiser rules? Anti-patterns table current?     |
| `02-code-standards.md` | ESLint limits match `eslint.config.js`? Testing patterns current?                   |
| `03-database.md`       | Cache implementations table accurate? Protected indexes list current?               |
| `04-discord.md`        | Shared utilities table lists all browse/dashboard helpers?                          |
| `05-tooling.md`        | All `pnpm ops` commands listed? `pnpm quality` description accurate?                |
| `06-backlog.md`        | Backlog structure table matches actual `backlog/*.md` files (one section per file)? |
| `07-documentation.md`  | Placement table covers all `docs/reference/` subdirs? Lifecycle rules current?      |

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

- [ ] All `proposals/active/` items are actually being worked on (check `backlog/current-focus.md`)
- [ ] No completed features still have active proposals (should be deleted)
- [ ] Backlog proposals still relevant (not implemented, not abandoned)

### 6. Research Notes

- [ ] Files in `docs/research/` are TL;DR format (2-5KB, not raw transcripts)
- [ ] No raw AI chat dumps (distill or delete)
- [ ] Research links to actionable items in `backlog/*.md` or proposals

### 8. Incidents

- [ ] `docs/incidents/PROJECT_POSTMORTEMS.md` entries match CLAUDE.md post-mortem table
- [ ] Recent incidents are documented
- [ ] Lessons learned are captured in relevant rules

### 9. Other Docs

- [ ] `docs/steam-deck/` setup guides still accurate for current SteamOS version
- [ ] `docs/steam-deck/` paths and commands work for the current dev environment

### 10. Root README.md

- [ ] Project structure lists all services in `services/` and all packages in `packages/`
- [ ] Architecture diagram matches actual services and external APIs
- [ ] Slash commands list matches actual commands in `services/bot-client/src/commands/`
- [ ] External APIs section lists all current providers (OpenRouter, ElevenLabs, etc.)
- [ ] Quick Start prerequisites are current (Node version, tools)
- [ ] Documentation links point to files that exist
- [ ] Planned features section is accurate (none secretly implemented)
- [ ] Feature list reflects current capabilities (voice, TTS, etc.)

### 11. Root CLAUDE.md

- [ ] All rules listed in Key Rules section (check `ls .claude/rules/`)
- [ ] Rules descriptions match actual rule file contents
- [ ] `pnpm quality` description matches root `package.json` script
- [ ] Post-mortem table includes recent incidents
- [ ] Project structure is accurate

### 12. Broken Internal References

Verify docs don't reference files that have been renamed or removed:

```bash
# Check for references to deprecated root tracking files
grep -r 'CURRENT_WORK\|ROADMAP' docs/ .claude/ --include='*.md' -l

# Canonical names: CURRENT.md, BACKLOG.md
# Any hits for CURRENT_WORK.md or ROADMAP.md are stale and must be updated
```

- [ ] No references to `CURRENT_WORK.md` (renamed to `CURRENT.md`)
- [ ] No references to `ROADMAP.md` (renamed to `BACKLOG.md`)
- [ ] Spot-check that linked `.md` files in docs actually exist

### 13. Cross-Reference Checks

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
3. Note any larger doc rewrites needed in `backlog/inbox.md`
4. Commit documentation fixes: `docs: audit and refresh documentation`

## References

- Documentation standards: `.claude/rules/07-documentation.md`
- Documentation philosophy: `docs/reference/DOCUMENTATION_PHILOSOPHY.md`
- Session docs skill: `.claude/skills/tzurot-docs/SKILL.md`
