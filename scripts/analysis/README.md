# Analysis Scripts

Code quality and pattern analysis utilities.

## Migration to ESLint Rules

Static analysis scripts have been migrated to ESLint rules in `@tzurot/tooling/eslint`. This provides:

- Automatic execution on save (via IDE integration)
- CI enforcement
- Better developer experience (inline errors)

### Migrated Scripts

| Script                       | ESLint Rule                   | Status                 |
| ---------------------------- | ----------------------------- | ---------------------- |
| `check-singleton-exports.js` | `@tzurot/no-singleton-export` | ✅ Deleted (migrated)  |
| `check-hardcoded-prefix.js`  | N/A                           | ✅ Deleted (v2 relic)  |
| `check-module-size.sh`       | Built-in `max-lines`          | ✅ Deleted (redundant) |

### Remaining Scripts

| Script                    | Purpose                           | Notes             |
| ------------------------- | --------------------------------- | ----------------- |
| `check-job-validation.sh` | Ensure BullMQ jobs use validation | → ESLint (future) |

## Using the ESLint Rules

To enable the custom rules, add to `eslint.config.js`:

```javascript
import tzurotPlugin from '@tzurot/tooling/eslint';

export default [
  // ... other configs
  {
    plugins: {
      '@tzurot': tzurotPlugin,
    },
    rules: {
      '@tzurot/no-singleton-export': 'error',
    },
  },
];
```

## Adding New Rules

See `packages/tooling/src/eslint/` for examples. New rules should:

1. Be created in `packages/tooling/src/eslint/`
2. Exported from `packages/tooling/src/eslint/index.ts`
3. Include comprehensive JSDoc with examples
4. Have test cases (future: add vitest tests)
