# Test Coverage Audit System

This document provides comprehensive details on the ratchet-based test coverage audits used in Tzurot v3.

## Overview

The project uses **ratchet audits** to prevent new untested code from being added. These are enforced in CI and can be run locally.

```bash
# Run both audits (CI does this automatically)
pnpm ops test:audit

# Contract coverage only
pnpm ops test:audit-contracts

# Service integration coverage only
pnpm ops test:audit-services

# Update baseline (after closing gaps)
pnpm ops test:audit-contracts --update
pnpm ops test:audit-services --update

# Strict mode (fails on ANY gap, not just new ones)
pnpm ops test:audit --strict
```

## Contract Coverage Audit

Prevents new API schemas from being added without contract tests.

### How It Works

1. Finds all Zod schemas in `packages/common-types/src/schemas/api/`
2. Checks which have `.safeParse()` calls in contract tests
3. Compares against `contract-coverage-baseline.json`
4. **Fails CI** if NEW untested schemas are added

### Adding Contract Tests

```typescript
// packages/common-types/src/types/MyFeature.contract.test.ts
import { MyResponseSchema } from '../schemas/api/myFeature.js';

describe('MyFeature API Contract', () => {
  it('should validate response structure', () => {
    const response = { id: '123', name: 'Test' };
    expect(MyResponseSchema.safeParse(response).success).toBe(true);
  });

  it('should reject invalid response', () => {
    const invalid = { id: 123 }; // Wrong type
    expect(MyResponseSchema.safeParse(invalid).success).toBe(false);
  });
});
```

## Service Integration Coverage Audit

Prevents new `*Service.ts` files from being added without component tests.

### How It Works

1. Finds all `*Service.ts` files in services/ and packages/
2. Checks which have `.component.test.ts` files
3. Compares against `service-integration-baseline.json`
4. **Fails CI** if NEW services are added without component tests

### Exemptions

Some services don't need component tests (re-exports, thin wrappers). Add to `exempt` array in baseline.

## Chip-Away Workflow

Existing gaps are tracked in baselines. Close them incrementally:

```bash
# 1. View current gaps
pnpm ops test:audit-contracts    # Contract test gaps
pnpm ops test:audit-services     # Component test gaps

# 2. Pick a gap and write tests
# Example: Close gap for PersonalityService
# Create: services/api-gateway/src/services/PersonalityService.component.test.ts

# 3. Update baseline to record progress
pnpm ops test:audit-services --update
```

**Target**: Close 2-3 gaps per week during maintenance sessions.

### Priority Order (from service-integration-baseline.json)

1. `services/ai-worker/src/services/LongTermMemoryService.ts` - core memory ops
2. `services/ai-worker/src/services/ConversationalRAGService.ts` - AI generation flow
3. `services/api-gateway/src/services/PersonalityService.ts` - used everywhere

## Coverage Requirements (Codecov Enforced)

| Target   | Threshold | Enforcement                                              |
| -------- | --------- | -------------------------------------------------------- |
| Project  | 80%       | Codecov blocks if drops >2%                              |
| Patch    | 80%       | New code must be 80%+ covered                            |
| Services | 80%       | Tracked per-service (ai-worker, api-gateway, bot-client) |
| Utils    | 90%       | Higher bar for shared utilities                          |

### Reading Coverage Data (json-summary)

Coverage runs generate `coverage/coverage-summary.json` with structured data:

```bash
# Read total or file-specific coverage (no grep chains!)
cat services/bot-client/coverage/coverage-summary.json | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d['total']['lines']['pct'])"
```

Structure: `{"total": {"lines": {"pct": 84.78}}, "/path/file.ts": {"lines": {...}}}`

### CI Gate

Codecov runs on every PR. Coverage report shows:

- Overall project coverage change
- Per-file coverage for changed files
- Patch coverage (new/modified lines only)

## Related Files

- Contract baseline: `contract-coverage-baseline.json`
- Service baseline: `service-integration-baseline.json`
- Audit commands: `packages/tooling/src/test/`
