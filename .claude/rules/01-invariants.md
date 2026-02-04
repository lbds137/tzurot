# Critical Invariants

These constraints MUST always be followed. Violations cause bugs, security issues, or CI failures.

## Architecture Boundaries

| Service     | Prisma Access | Why                                               |
| ----------- | ------------- | ------------------------------------------------- |
| bot-client  | NEVER         | Use gateway APIs (`callGatewayApi`, `adminFetch`) |
| api-gateway | Yes           | Source of truth for data                          |
| ai-worker   | Yes           | Memory and AI operations                          |

**Anti-patterns:**

- Direct `fetch()` to gateway - use typed clients
- Importing Prisma in bot-client - architectural violation
- Cross-service direct imports - use common-types

## Security (CRITICAL)

- **Shell commands**: Use `execFileSync(['cmd', 'arg1', 'arg2'])`, NEVER `execSync('cmd arg1 arg2')`
- **Secrets**: Never commit `.env`, credentials, tokens. Use Railway env vars.
- **User input**: Validate with Zod at service boundaries. Never trust Discord input.

## Code Quality (ESLint Enforced)

| Rule            | Limit             | Action              |
| --------------- | ----------------- | ------------------- |
| File length     | 500 lines (error) | Extract modules     |
| Function length | 100 lines         | Extract helpers     |
| Complexity      | 15                | Simplify or extract |
| Nesting depth   | 4                 | Early returns       |

- TypeScript `strict: true`, no `any` types
- 80% test coverage (Codecov enforced)

## Testing

- **Never modify tests to make them pass** - fix the implementation
- **Coverage required**: 80% minimum, Codecov blocks PRs below threshold
- **Mocking**: Use `vi.mock()` with factory, not `vi.fn()` everywhere

## Database

- **Bounded queries**: All `findMany` MUST have `take` limit
- **Migrations**: Use `pnpm ops db:migrate`, never raw `prisma migrate`
- **pgvector**: Use `Prisma.$queryRaw` for similarity search, not ORM

## Git Safety

- **REBASE-ONLY** workflow. No squash. No merge commits.
- **Never** run destructive commands without explicit user approval:
  - `git restore`, `git reset --hard`, `git clean -f`
  - `git push --force` (especially to main/develop)
- **Pre-push hooks** run tests - don't bypass with `--no-verify`

## Discord

- **3-second rule**: Call `interaction.deferReply()` within 3 seconds
- **Deterministic UUIDs**: Never use `uuid.v4()`, use generators from common-types
