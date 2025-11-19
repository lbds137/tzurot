---
name: tzurot-docs
description: Documentation maintenance for Tzurot v3 - Updating CURRENT_WORK.md, CHANGELOG.md, folder structure, and keeping docs current. Use at session end or when documentation needs updating.
---

# Tzurot v3 Documentation Maintenance

**Use this skill when:** Ending a session, completing a milestone, creating new documentation, or updating existing docs.

## Documentation Philosophy

**For a one-person project with AI assistance, documentation is CRITICAL for context preservation.**

Without proper docs, each new session starts with a blank slate. Good documentation:
- Preserves context across sessions
- Records decisions and rationale
- Tracks progress and prevents duplicate work
- Helps AI assistants understand project state

## Core Documentation Files

### CURRENT_WORK.md (Most Important!)

**Purpose:** Single source of truth for what's happening RIGHT NOW

**Update at:**
- Start of session (read to understand context)
- End of session (document progress)
- Switching focus areas (record new direction)
- Completing major milestones

**Format:**
```markdown
> Last updated: YYYY-MM-DD

## Status: [Brief description of current focus]

**Current Phase**: [What you're actively working on]

**Recent Completion**: [Major milestone just finished]

## Active Work
[Details of current task - what's in progress, blockers, next steps]

## Planned Features (Priority Order)
[Upcoming work in priority order]

## Technical Debt
[Known issues to address later]
```

**Example:**
```markdown
> Last updated: 2025-11-19

## Status: Claude Code Skills Implementation

**Current Phase**: Creating 10 project-specific skills to streamline development workflow

**Recent Completion**: Smart cache invalidation (PR #244) - Redis pub/sub for cross-service cache invalidation

## Active Work
### Skills Creation (feat/claude-code-skills)
- ✅ tzurot-testing - Vitest patterns, fake timers, mocking
- ✅ tzurot-constants - Magic numbers, domain separation
- ✅ tzurot-git-workflow - Rebase-only, PR format
- 🚧 tzurot-docs - Documentation maintenance (this skill!)
- ⏳ 6 more skills to create

## Planned Features (Priority Order)
1. Complete remaining 6 skills
2. Test skills functionality in Claude Code
3. BYOK (Bring Your Own Key) - Critical for public launch
4. Admin commands (/admin servers, /admin kick)
```

**When NOT to update:**
- Minor changes that don't affect project direction
- Small bug fixes
- Routine refactoring

### CHANGELOG.md

**Purpose:** Record all notable changes for users/developers

**Update when:**
- Merging PRs to develop
- Releasing new versions
- Making breaking changes

**Format:** Follow [Keep a Changelog](https://keepachangelog.com/)
```markdown
# Changelog

All notable changes to Tzurot v3 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Smart cache invalidation via Redis pub/sub (PR #244)
- Claude Code Skills for project-specific workflows

### Fixed
- Resource leak in CacheInvalidationService subscribe() error path

### Changed
- Centralized Redis channel constants to REDIS_CHANNELS

## [3.0.0-alpha.43] - 2025-11-17

### Added
- Image attachment support in Discord messages
- Voice transcription via Whisper API
...
```

**Categories:**
- **Added** - New features
- **Changed** - Changes to existing functionality
- **Deprecated** - Soon-to-be-removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Security fixes

### CLAUDE.md

**Purpose:** Project-specific configuration and guidelines for AI assistants

**Update when:**
- Establishing new patterns (like constants management)
- Adding important context (post-mortems)
- Changing project structure
- Documenting new conventions

**Don't update for:**
- Individual feature details (those go in docs/)
- Temporary decisions
- One-off instructions

## Documentation Structure

All documentation lives in `docs/` organized by category:

```
docs/
├── README.md                   # Documentation index
├── architecture/               # Design decisions, patterns
│   └── ARCHITECTURE_DECISIONS.md
├── deployment/                 # Railway, infrastructure
│   └── RAILWAY_DEPLOYMENT.md
├── guides/                     # How-to guides
│   ├── DEVELOPMENT.md
│   └── TESTING.md
├── features/                   # Feature specifications
├── improvements/               # Enhancement proposals
├── migration/                  # Data migration procedures
├── operations/                 # Operational procedures
├── planning/                   # Roadmaps, feature tracking
│   ├── V3_REFINEMENT_ROADMAP.md
│   └── V2_FEATURE_TRACKING.md
├── reference/                  # Reference documentation
│   └── RAILWAY_CLI_REFERENCE.md
└── templates/                  # Reusable templates
```

### When to Create New Documentation

**Create in `docs/` when:**
- Documenting a complex feature
- Recording architectural decisions
- Writing operational procedures
- Creating reusable templates

**Don't create when:**
- Feature is simple and obvious
- Information already exists elsewhere
- It's temporary information

**Root documentation rules:**
- **ONLY these files belong in root:** README.md, CHANGELOG.md, CLAUDE.md, CURRENT_WORK.md
- Everything else goes in `docs/`

## Documentation Best Practices

### 1. Use Descriptive Names
```
# ✅ GOOD
docs/architecture/memory-and-context-redesign.md
docs/planning/v3-refinement-roadmap.md

# ❌ BAD
docs/memory.md
docs/plan.md
```

### 2. Update Existing Docs Instead of Creating New Ones
```
# ✅ GOOD - Update existing
echo "New section" >> docs/guides/TESTING.md

# ❌ BAD - Create duplicate
touch docs/guides/TESTING_NEW.md
```

### 3. Delete Obsolete Docs
Git history preserves them, so it's safe to delete when outdated.

```bash
# If doc is obsolete, delete it
git rm docs/planning/obsolete-feature-spec.md
git commit -m "docs: remove obsolete feature spec (implemented in v3.0.0-alpha.40)"
```

### 4. Use Consistent Date Format
```
# ✅ GOOD
> Last updated: 2025-11-19

# ❌ BAD
> Last updated: Nov 19, 2025
> Last updated: 11/19/2025
```

### 5. Link Between Related Docs
```markdown
## References

- Architecture decisions: `docs/architecture/ARCHITECTURE_DECISIONS.md`
- Testing guide: `docs/guides/TESTING.md`
- V2 feature tracking: `docs/planning/V2_FEATURE_TRACKING.md`
```

## Session Handoff Protocol

**At end of session:**

1. **Update CURRENT_WORK.md**
```bash
# Get current date
date +%Y-%m-%d

# Edit CURRENT_WORK.md with progress made
```

2. **Delete obsolete docs**
```bash
# If any docs are now outdated
git rm docs/planning/completed-feature.md
```

3. **Update relevant doc timestamps**
```bash
# If you modified architectural docs or guides
# Update their "Last updated" timestamp
```

4. **Commit work-in-progress if needed**
```bash
# Use descriptive WIP commit messages
git commit -m "wip: skills creation - 5/10 complete"
```

**When switching work focus:**

1. **Update CURRENT_WORK.md** to reflect new direction
2. **Delete obsolete docs** (git history preserves them)
3. **Update CLAUDE.md** if project context changed significantly

## Documentation Anti-Patterns

### ❌ Don't Create Documentation Bloat
```
# ❌ BAD - Too many docs for same topic
docs/testing/
├── testing-guide.md
├── test-patterns.md
├── vitest-setup.md
├── mocking-guide.md
└── test-best-practices.md

# ✅ GOOD - One comprehensive guide
docs/guides/
└── TESTING.md  # All testing info in one place
```

### ❌ Don't Let CURRENT_WORK.md Get Stale
```
# ❌ BAD - Last updated 2 months ago
> Last updated: 2025-09-19

## Status: Working on X feature
[Feature X was completed and deployed weeks ago]

# ✅ GOOD - Updated recently
> Last updated: 2025-11-19

## Status: Claude Code Skills Implementation
[Accurate current state]
```

### ❌ Don't Create README files in every directory
```
# ❌ BAD - README bloat
services/bot-client/README.md
services/api-gateway/README.md
services/ai-worker/README.md

# ✅ GOOD - One main README, detailed docs in docs/
README.md
docs/architecture/ARCHITECTURE_DECISIONS.md
```

### ❌ Don't Document Obvious Things
```
# ❌ BAD - Documenting the obvious
## How to Install Dependencies
Run `pnpm install` to install dependencies.

# ✅ GOOD - Document the non-obvious
## Development Setup
After installing dependencies, you must:
1. Set up Railway CLI: `railway login`
2. Link to development project: `railway link`
3. Pull environment variables: `railway run --service api-gateway env > .env`
```

## Context Preservation for AI

**Why this matters:** Each new AI session starts with limited context. Good documentation helps AI:
- Understand current project state
- Avoid suggesting completed work
- Follow established patterns
- Make informed decisions

**Critical files to check at session start:**
1. CURRENT_WORK.md - What's happening now?
2. CLAUDE.md - What are the rules?
3. docs/README.md - What docs exist?
4. Recent git commits - What changed recently?

## Linking Documentation

**Use relative paths for internal links:**
```markdown
# ✅ GOOD
See [Testing Guide](docs/guides/TESTING.md) for details.

# ❌ BAD
See Testing Guide at /home/user/project/docs/guides/TESTING.md
```

**Use code-style for file references:**
```markdown
# ✅ GOOD
Update `CURRENT_WORK.md` at session end.

# ❌ BAD
Update CURRENT_WORK.md at session end.
```

## Documentation Review Checklist

Before ending a session, verify:

- [ ] CURRENT_WORK.md reflects actual current state
- [ ] CHANGELOG.md includes merged PRs (if any)
- [ ] Obsolete docs deleted
- [ ] New docs follow naming conventions
- [ ] Documentation timestamps updated (YYYY-MM-DD format)
- [ ] Links between docs are correct
- [ ] No duplicate information across docs

## References

- Documentation structure: `docs/README.md`
- Current project status: `CURRENT_WORK.md`
- Project guidelines: `CLAUDE.md`
- Documentation maintenance: `CLAUDE.md#documentation-maintenance`
