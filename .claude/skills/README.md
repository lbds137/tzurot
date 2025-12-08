# Tzurot v3 Skills Index

> **Quick Navigation**: This directory contains 13 project-specific Claude Code Skills that codify Tzurot v3 development best practices and streamline workflows.

## 📋 All Skills

| Skill                                                   | Category     | Use When                                                            |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| [tzurot-testing](./tzurot-testing/SKILL.md)             | Core Dev     | Writing/debugging tests, using fake timers, mocking dependencies    |
| [tzurot-constants](./tzurot-constants/SKILL.md)         | Core Dev     | Removing magic numbers, organizing constants by domain              |
| [tzurot-git-workflow](./tzurot-git-workflow/SKILL.md)   | Core Dev     | Creating commits/PRs, rebasing, handling git operations             |
| [tzurot-security](./tzurot-security/SKILL.md)           | Core Dev     | Handling secrets, user input, security-critical code                |
| [tzurot-operations](./tzurot-operations/SKILL.md)       | Core Dev     | Adding personalities, checking health, debugging production issues  |
| [tzurot-architecture](./tzurot-architecture/SKILL.md)   | Architecture | Designing features, deciding where code belongs, error patterns     |
| [tzurot-docs](./tzurot-docs/SKILL.md)                   | Architecture | Updating documentation, session handoff                             |
| [tzurot-gemini-collab](./tzurot-gemini-collab/SKILL.md) | Architecture | Consulting Gemini MCP, getting second opinions                      |
| [tzurot-shared-types](./tzurot-shared-types/SKILL.md)   | Advanced     | Creating types, Zod schemas, type guards                            |
| [tzurot-db-vector](./tzurot-db-vector/SKILL.md)         | Advanced     | Working with PostgreSQL, pgvector, database queries                 |
| [tzurot-async-flow](./tzurot-async-flow/SKILL.md)       | Advanced     | BullMQ jobs, Discord deferrals, async patterns                      |
| [tzurot-observability](./tzurot-observability/SKILL.md) | Advanced     | Adding logging, debugging production issues                         |
| [tzurot-deployment](./tzurot-deployment/SKILL.md)       | Advanced     | Deploying to Railway, managing services, troubleshooting production |

## 🎯 Decision Tree: Which Skill Do I Need?

### "I'm writing tests..."

→ **tzurot-testing** - Fake timers, promise rejection handling, mocking patterns

### "I have a magic number/string..."

→ **tzurot-constants** - When to create constants, domain organization

### "I'm about to commit/push..."

→ **tzurot-git-workflow** - Commit format, PR creation, rebase workflow

### "I'm handling secrets or user input..."

→ **tzurot-security** - Secret management, PII scrubbing, security best practices

### "I need to design a new feature..."

→ **tzurot-architecture** + **tzurot-async-flow** - Service boundaries, async patterns

### "Where does this code belong?"

→ **tzurot-architecture** - Service responsibilities, anti-patterns

### "I'm creating types that multiple services need..."

→ **tzurot-shared-types** - Type centralization, Zod schemas, type guards

### "I'm working with the database..."

→ **tzurot-db-vector** - Connection pooling, migrations, pgvector similarity search

### "I'm creating a BullMQ job..."

→ **tzurot-async-flow** - Job naming, idempotency, retry strategies

### "I'm adding logging or debugging..."

→ **tzurot-observability** - Structured logging, correlation IDs, privacy

### "I need to update documentation..."

→ **tzurot-docs** - CURRENT_WORK.md format, session handoff

### "I'm stuck on a complex problem..."

→ **tzurot-gemini-collab** - When/how to consult Gemini 3 Pro

### "I'm deploying to Railway or debugging production..."

→ **tzurot-deployment** - Service management, logs, environment variables, troubleshooting

### "I'm doing routine operations (adding personality, checking health)..."

→ **tzurot-operations** - Adding personalities, checking health, debugging, database tasks

## 🔗 Common Skill Combinations

### Building a New Feature

1. **tzurot-architecture** - Determine service placement
2. **tzurot-async-flow** - Design async workflows if needed
3. **tzurot-shared-types** - Create shared types
4. **tzurot-constants** - Define constants
5. **tzurot-testing** - Write tests
6. **tzurot-docs** - Update documentation

### Fixing a Bug

1. **tzurot-observability** - Review logs, add debugging
2. **tzurot-testing** - Write regression test
3. **tzurot-git-workflow** - Create fix commit/PR

### Security-Sensitive Work

1. **tzurot-security** - Review security patterns
2. **tzurot-observability** - Ensure no PII in logs
3. **tzurot-shared-types** - Validate inputs with Zod
4. **tzurot-testing** - Test security edge cases

### Database Changes

1. **tzurot-db-vector** - Database patterns
2. **tzurot-shared-types** - Update Prisma schema and types
3. **tzurot-testing** - Test database operations
4. **tzurot-observability** - Add query logging

## 📚 Skill Relationships

### Dependencies (Read These First)

- **tzurot-constants** - Referenced by testing, async-flow, observability
- **tzurot-architecture** - Foundation for all technical skills
- **tzurot-shared-types** - Used by db-vector, async-flow

### Complementary Pairs

- **tzurot-architecture** ↔ **tzurot-async-flow** - Service design + async patterns
- **tzurot-security** ↔ **tzurot-observability** - Security logging + monitoring
- **tzurot-testing** ↔ **tzurot-constants** - Test organization + test data
- **tzurot-db-vector** ↔ **tzurot-shared-types** - Database + type safety

## 🔄 Skill Maintenance

### When to Update Skills

- New patterns emerge from production experience
- Post-mortem lessons learned
- Architecture changes
- Tool upgrades (e.g., Vitest version)
- PR feedback identifies missing patterns

### How to Update Skills

1. Create feature branch
2. Update relevant skill(s)
3. Update "Last Updated" timestamp in frontmatter
4. Add changelog entry if significant change
5. Create PR with clear description of changes

### Skill Quality Checklist

- [ ] Clear YAML frontmatter (name, description, lastUpdated)
- [ ] Concrete examples with ✅/❌ patterns
- [ ] Related Skills section
- [ ] Cross-references to docs/CLAUDE.md where appropriate
- [ ] Real project context (not generic advice)

## 💡 Tips for Using Skills

### Auto-Activation

Skills automatically activate when Claude Code detects relevant context:

- Editing test files → tzurot-testing activates
- Working with constants → tzurot-constants activates
- Committing changes → tzurot-git-workflow activates

### Manual Invocation

You can explicitly invoke skills using the Skill tool:

```
skill: "tzurot-testing"       # Testing guidance
skill: "tzurot-security"      # Security patterns
skill: "tzurot-architecture"  # Design decisions
```

### Searching Skills

Use grep to search across all skills:

```bash
# Find all references to BullMQ
grep -r "BullMQ" .claude/skills/

# Find security patterns
grep -r "security" .claude/skills/ -i

# Find all examples of a specific pattern
grep -r "TIMEOUTS\." .claude/skills/
```

## 📊 Skill Statistics

- **Total Skills**: 13
- **Total Lines**: ~6,500 lines of documentation
- **Coverage**: Full development lifecycle
- **Source Control**: All skills version-controlled
- **Maintenance**: Updated via PR process

## 🎉 Benefits

**For Solo Development:**

- ✅ Preserves knowledge across AI sessions
- ✅ Reduces back-and-forth on common decisions
- ✅ Enforces consistency across development
- ✅ Codifies lessons learned from production incidents

**For AI Assistance:**

- ✅ Provides project-specific context automatically
- ✅ Reduces hallucination with concrete examples
- ✅ Enables consistent decision-making
- ✅ Accelerates implementation with proven patterns

---

**Last Updated**: 2025-12-08

For questions about skills or suggestions for new ones, see [CLAUDE.md](../../CLAUDE.md#claude-code-skills).
