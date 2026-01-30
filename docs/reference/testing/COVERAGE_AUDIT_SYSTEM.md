# Test Coverage Audit System

This document provides comprehensive details on the ratchet-based test coverage audits used in Tzurot v3.

## Overview

The project uses a **unified ratchet audit** to prevent new untested code from being added. This is enforced in CI and can be run locally.

```bash
# Run unified audit (CI does this automatically)
pnpm ops test:audit

# Filter by category
pnpm ops test:audit --category=services   # Service tests only
pnpm ops test:audit --category=contracts  # Contract tests only

# Update baseline (after closing gaps)
pnpm ops test:audit --update
pnpm ops test:audit --category=services --update  # Update only services

# Strict mode (fails on ANY gap, not just new ones)
pnpm ops test:audit --strict

# Verbose output (show all covered items)
pnpm ops test:audit --verbose
```

## Unified Baseline

All test coverage tracking uses a single baseline file: `test-coverage-baseline.json`

```json
{
  "version": 1,
  "lastUpdated": "2026-01-30T00:00:00.000Z",
  "services": {
    "knownGaps": ["path/to/UncoveredService.ts"],
    "exempt": ["path/to/ServiceWithoutPrisma.ts"]
  },
  "contracts": {
    "knownGaps": ["schema-file:SchemaName"]
  },
  "notes": {
    "serviceExemptionCriteria": "Services without direct Prisma calls are exempt",
    "contractExemptionCriteria": "None - all API schemas need contract tests"
  }
}
```

## Service Coverage Audit

Prevents new `*Service.ts` files from being added without tests.

### How It Works

1. Finds all `*Service.ts` files in services/ and packages/
2. Checks which have `.int.test.ts` files
3. Compares against baseline's `services.knownGaps`
4. **Fails CI** if NEW services are added without tests

### Exemptions

Some services don't need tests (re-exports, thin wrappers, no DB access). Add to `services.exempt` in baseline.

## Schema Coverage Audit

Prevents new API schemas from being added without schema tests.

### How It Works

1. Finds all Zod schemas in `packages/common-types/src/schemas/api/`
2. Checks which have `.safeParse()` calls in `.schema.test.ts` files
3. Compares against baseline's `contracts.knownGaps`
4. **Fails CI** if NEW untested schemas are added

### Adding Schema Tests

```typescript
// packages/common-types/src/types/MyFeature.schema.test.ts
import { MyResponseSchema } from '../schemas/api/myFeature.js';

describe('MyFeature API Schema', () => {
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

## Chip-Away Workflow

Existing gaps are tracked in the baseline. Close them incrementally:

```bash
# 1. View current gaps
pnpm ops test:audit --verbose

# 2. Pick a gap and write tests
# Example: Close gap for PersonalityService
# Create: services/api-gateway/src/services/PersonalityService.int.test.ts

# 3. Update baseline to record progress
pnpm ops test:audit --update
```

**Target**: Close 2-3 gaps per week during maintenance sessions.

### Priority Order (from baseline)

1. `services/ai-worker/src/services/LongTermMemoryService.ts` - core memory ops
2. `services/ai-worker/src/services/ConversationalRAGService.ts` - AI generation flow
3. `packages/common-types/src/services/ConversationRetentionService.ts` - retention logic

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

## Audit Output Format

```
════════════════════════════════════════════════════════════
📊 Unified Test Coverage Audit
════════════════════════════════════════════════════════════

📦 SERVICE TESTS (DB interaction testing)
────────────────────────────────────────────────────────────
Total services:     23
Exempt:             17 (no direct Prisma calls)
Auditable:          6
Covered:            3 (via .int.test.ts)
Gaps:               3

📋 Known gaps (from baseline):
   - ConversationRetentionService.ts
   - ConversationSyncService.ts
   - LongTermMemoryService.ts

════════════════════════════════════════════════════════════

📜 SCHEMA TESTS (API schema validation)
────────────────────────────────────────────────────────────
Total schemas:      62
Tested:             0
Gaps:               62

📋 Known gaps (from baseline):
   - adminSettings:AdminSettingsSchema
   ... (truncated)

════════════════════════════════════════════════════════════

🎯 RATCHET SUMMARY
────────────────────────────────────────────────────────────
Service tests:  ✅ PASS (no new gaps)
Schema tests:   ✅ PASS (no new gaps)

Overall:        ✅ ALL AUDITS PASSED
════════════════════════════════════════════════════════════
```

## Deprecated Commands

The following commands are deprecated but still work (with warnings):

```bash
# DEPRECATED - use pnpm ops test:audit --category=contracts
pnpm ops test:audit-contracts

# DEPRECATED - use pnpm ops test:audit --category=services
pnpm ops test:audit-services
```

## Related Files

- Unified baseline: `test-coverage-baseline.json`
- Audit implementation: `packages/tooling/src/test/audit-unified.ts`
- CLI commands: `packages/tooling/src/commands/test.ts`
