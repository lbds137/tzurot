# @tzurot/tooling

Internal tooling package for Tzurot v3 monorepo operations.

## Usage

```bash
# See all available commands
pnpm ops --help

# Database operations
pnpm ops db:check-drift      # Check for migration drift
pnpm ops db:fix-drift <name> # Fix drifted migrations
pnpm ops db:inspect          # Inspect database state

# Data operations
pnpm ops data:import <name>  # Import a personality
pnpm ops data:bulk-import    # Bulk import all

# Deployment
pnpm ops deploy:dev          # Deploy to Railway dev
pnpm ops deploy:verify       # Verify build
```

## Architecture

```
packages/tooling/
├── src/
│   ├── cli.ts              # Main CLI entry point (cac)
│   ├── commands/           # Command registrations
│   │   ├── db.ts           # Database commands
│   │   ├── data.ts         # Data import/export commands
│   │   └── deploy.ts       # Deployment commands
│   ├── db/                 # Database utilities
│   ├── data/               # Data import utilities
│   └── deployment/         # Deployment utilities
└── package.json
```

## Design Principles

1. **Lazy Loading**: Commands dynamically import their implementations for fast CLI startup
2. **Unified Interface**: One CLI (`pnpm ops`) instead of many scattered scripts
3. **Type Safety**: Full TypeScript with shared types from `@tzurot/common-types`
4. **Progressive Migration**: Legacy scripts remain functional while being migrated

## Adding New Commands

1. Create implementation in appropriate subdirectory (e.g., `src/db/new-command.ts`)
2. Export an async function that performs the operation
3. Register in the corresponding command file (e.g., `src/commands/db.ts`)
4. Add options using `cac`'s fluent API

Example:

```typescript
// src/db/new-command.ts
export async function newCommand(options: { verbose?: boolean }): Promise<void> {
  // Implementation
}

// src/commands/db.ts
cli
  .command('db:new-command', 'Description here')
  .option('--verbose', 'Verbose output')
  .action(async options => {
    const { newCommand } = await import('../db/new-command.js');
    await newCommand(options);
  });
```

## Dependencies

- `cac` - Lightweight CLI framework
- `chalk` - Terminal colors
- `ora` - Spinners for long operations
- `@tzurot/common-types` - Shared types and Prisma client
