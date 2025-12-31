# Tzurot v3 Skills Index

> **Quick Navigation**: 14 project-specific Claude Code Skills that codify Tzurot v3 development best practices.

## 📋 All Skills

| Skill                                                   | Category | Use When                            |
| ------------------------------------------------------- | -------- | ----------------------------------- |
| [tzurot-code-quality](./tzurot-code-quality/SKILL.md)   | Core Dev | Lint errors, refactoring, ESLint    |
| [tzurot-testing](./tzurot-testing/SKILL.md)             | Core Dev | Writing tests, fake timers, mocking |
| [tzurot-types](./tzurot-types/SKILL.md)                 | Core Dev | Types, constants, Zod schemas       |
| [tzurot-git-workflow](./tzurot-git-workflow/SKILL.md)   | Core Dev | Commits, PRs, rebasing              |
| [tzurot-security](./tzurot-security/SKILL.md)           | Core Dev | Secrets, user input, security       |
| [tzurot-observability](./tzurot-observability/SKILL.md) | Core Dev | Logging, debugging, operations      |
| [tzurot-architecture](./tzurot-architecture/SKILL.md)   | Design   | Service design, error patterns      |
| [tzurot-docs](./tzurot-docs/SKILL.md)                   | Design   | Documentation, session handoff      |
| [tzurot-council-mcp](./tzurot-council-mcp/SKILL.md)     | Design   | Consulting external AI              |
| [tzurot-db-vector](./tzurot-db-vector/SKILL.md)         | Advanced | PostgreSQL, pgvector, migrations    |
| [tzurot-async-flow](./tzurot-async-flow/SKILL.md)       | Advanced | BullMQ jobs, Discord deferrals      |
| [tzurot-deployment](./tzurot-deployment/SKILL.md)       | Advanced | Railway deployment, troubleshooting |
| [tzurot-caching](./tzurot-caching/SKILL.md)             | Advanced | Cache patterns, horizontal scaling  |
| [tzurot-skills-guide](./tzurot-skills-guide/SKILL.md)   | Meta     | Writing and maintaining skills      |

## 🎯 Quick Decision Tree

| Task                     | Skill                |
| ------------------------ | -------------------- |
| Fixing lint warnings     | tzurot-code-quality  |
| Refactoring complex code | tzurot-code-quality  |
| Writing tests            | tzurot-testing       |
| Creating types/constants | tzurot-types         |
| Committing/pushing       | tzurot-git-workflow  |
| Handling secrets         | tzurot-security      |
| Adding logging           | tzurot-observability |
| Designing features       | tzurot-architecture  |
| Database work            | tzurot-db-vector     |
| BullMQ jobs              | tzurot-async-flow    |
| Deploying to Railway     | tzurot-deployment    |
| Updating docs            | tzurot-docs          |
| Stuck on problem         | tzurot-council-mcp   |
| Cache patterns           | tzurot-caching       |
| Creating/updating skills | tzurot-skills-guide  |

## 🔗 Common Combinations

**New Feature**: architecture → async-flow → types → testing → docs

**Bug Fix**: observability → testing → git-workflow

**Refactoring**: code-quality → testing → git-workflow

**Security Work**: security → observability → types → testing

**Database Changes**: db-vector → types → testing → observability

## 📊 Statistics

- **Total Skills**: 14
- **Total Lines**: ~3,100 lines
- **All skills**: Under 350 lines (target: <300, max: 400)
- **Pattern**: Progressive disclosure - essential info with references

## 🔄 Maintenance

See [tzurot-skills-guide](./tzurot-skills-guide/SKILL.md) for:

- When to create vs update skills
- Size limits and progressive disclosure
- Quality checklist and anti-patterns

---

**Last Updated**: 2025-12-31
