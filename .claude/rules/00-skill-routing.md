# Skill Routing Map

When working on this project, load the appropriate skill BEFORE implementation based on the task domain.

## Routing Table

| If your task involves...                           | Load skill                 |
| -------------------------------------------------- | -------------------------- |
| Prisma, schema, migration, database query          | `/tzurot-db-vector`        |
| `.test.ts`, vitest, mock, fake timer, coverage     | `/tzurot-testing`          |
| BullMQ, job, queue, deferral, retry logic          | `/tzurot-async-flow`       |
| Railway, deploy, production logs, live issues      | `/tzurot-deployment`       |
| slash command, button, pagination, Discord UX      | `/tzurot-slash-command-ux` |
| git commit, git push, PR, rebase                   | `/tzurot-git-workflow`     |
| secret, security, execSync, user input             | `/tzurot-security`         |
| types, Zod, schema validation, constants           | `/tzurot-types`            |
| refactor, lint error, complexity, ESLint           | `/tzurot-code-quality`     |
| CURRENT.md, BACKLOG.md, session end, wrap up       | `/tzurot-docs`             |
| MCP, council, second opinion, stuck                | `/tzurot-council-mcp`      |
| service boundary, architecture, where code belongs | `/tzurot-architecture`     |
| cache, TTL, Redis, stale data                      | `/tzurot-caching`          |
| logging, debugging, correlation ID                 | `/tzurot-observability`    |
| CLI, ops, pnpm script                              | `/tzurot-tooling`          |
| creating/updating skills, SKILL.md                 | `/tzurot-skills-guide`     |

## How to Use

1. Before implementing, scan the routing table
2. If ANY row matches your task, invoke that skill with `Skill("skill-name")`
3. Follow the skill's procedures and patterns
4. Multiple skills can apply - load all relevant ones

## Critical Skills (Always Consider)

- **Security**: Any user input, shell commands, or secrets handling
- **Testing**: Before writing ANY test code
- **Git Workflow**: Before ANY git operations
