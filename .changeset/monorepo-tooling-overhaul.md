---
'@tzurot/tooling': patch
---

Add new monorepo tooling infrastructure with Turborepo integration

- New `@tzurot/tooling` package with unified CLI (`pnpm ops`)
- Database commands: `db:check-drift`, `db:fix-drift`, `db:inspect`, `db:safe-migrate`
- Cache commands: `cache:inspect`, `cache:clear`
- Custom ESLint rule: `@tzurot/no-singleton-export` (enabled at warning level)
- Husky hooks: pre-commit (lint-staged, secretlint), pre-push (turbo build/test), commit-msg (commitlint)
- Turborepo configuration for cached builds and tests
