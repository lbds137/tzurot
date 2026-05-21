/**
 * Tests for the `audit.config.ts/.json` suppression mechanism.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadAuditConfig,
  validateSuppressions,
  applySuppressions,
} from './schema-audit-suppression.js';
import type { PrismaField } from './schema-audit-parser.js';
import type { AuditFinding } from './schema-audit-findings.js';
import { withTempDir } from './schema-audit-test-helpers.js';

const someField: PrismaField = {
  model: 'User',
  field: 'nsfwVerifiedAt',
  type: 'DateTime',
  optional: true,
  defaultValue: null,
  doc: null,
};
const otherField: PrismaField = {
  model: 'User',
  field: 'defaultLlmConfigId',
  type: 'String',
  optional: true,
  defaultValue: null,
  doc: null,
};

describe('loadAuditConfig', () => {
  it('returns empty suppressions when the config file does not exist', async () => {
    const result = await loadAuditConfig('/no/such/path/audit.config.ts');
    expect(result).toEqual({ suppressions: [] });
  });

  it('loads a JSON config file', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.json');
      writeFileSync(
        path,
        JSON.stringify({
          suppressions: [{ key: 'User.nsfwVerifiedAt', reason: 'state machine' }],
        })
      );
      const result = await loadAuditConfig(path);
      expect(result.suppressions).toHaveLength(1);
      expect(result.suppressions[0].key).toBe('User.nsfwVerifiedAt');
    });
  });

  it('loads a .ts config file', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.ts');
      writeFileSync(
        path,
        `export const schemaAuditConfig = {
  suppressions: [{ key: 'User.nsfwVerifiedAt', reason: 'state machine via ts config' }],
};
`
      );
      const result = await loadAuditConfig(path);
      expect(result.suppressions).toHaveLength(1);
      expect(result.suppressions[0].reason).toBe('state machine via ts config');
    });
  });

  it('throws when the .ts file does not export schemaAuditConfig', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.ts');
      writeFileSync(path, `export const wrongName = { suppressions: [] };\n`);
      await expect(loadAuditConfig(path)).rejects.toThrow(/must export `schemaAuditConfig`/);
    });
  });

  it('throws when JSON config is not an object', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.json');
      writeFileSync(path, JSON.stringify(['not', 'an', 'object']));
      await expect(loadAuditConfig(path)).rejects.toThrow(/expected an object/);
    });
  });

  it('throws when JSON config is missing the suppressions array', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.json');
      writeFileSync(path, JSON.stringify({ wrongKey: [] }));
      await expect(loadAuditConfig(path)).rejects.toThrow(/`suppressions` must be an array/);
    });
  });

  it('throws when JSON suppressions[i] is not an object', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.json');
      writeFileSync(path, JSON.stringify({ suppressions: ['not-an-object'] }));
      await expect(loadAuditConfig(path)).rejects.toThrow(/suppressions\[0\]` must be an object/);
    });
  });

  it('throws when JSON suppressions[i].key is not a string', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.json');
      writeFileSync(path, JSON.stringify({ suppressions: [{ key: 42, reason: 'r' }] }));
      await expect(loadAuditConfig(path)).rejects.toThrow(/\.key` must be a string/);
    });
  });

  it('throws when JSON suppressions[i].reason is not a string', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.json');
      writeFileSync(path, JSON.stringify({ suppressions: [{ key: 'k', reason: 42 }] }));
      await expect(loadAuditConfig(path)).rejects.toThrow(/\.reason` must be a string/);
    });
  });

  it('throws when JSON suppressions[i].reviewedAt is not a string when present', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.json');
      writeFileSync(
        path,
        JSON.stringify({ suppressions: [{ key: 'k', reason: 'r', reviewedAt: 42 }] })
      );
      await expect(loadAuditConfig(path)).rejects.toThrow(/\.reviewedAt` must be a string/);
    });
  });

  it('also validates .ts config exports', async () => {
    await withTempDir(async dir => {
      const path = join(dir, 'audit.config.ts');
      writeFileSync(path, `export const schemaAuditConfig = { suppressions: 'not-an-array' };\n`);
      await expect(loadAuditConfig(path)).rejects.toThrow(/must be an array/);
    });
  });
});

describe('validateSuppressions', () => {
  it('passes when every suppressed key resolves to an optional field', () => {
    expect(() =>
      validateSuppressions(
        [{ key: 'User.nsfwVerifiedAt', reason: 'state machine' }],
        [someField, otherField]
      )
    ).not.toThrow();
  });

  it('throws when a suppression key does not resolve to any field', () => {
    expect(() =>
      validateSuppressions(
        [{ key: 'User.ghostField', reason: 'whatever' }],
        [someField, otherField]
      )
    ).toThrow(/does not resolve/);
  });

  it('throws when a suppression key resolves to a NOT-NULL field (column was tightened)', () => {
    expect(() =>
      validateSuppressions(
        [{ key: 'User.discordId', reason: 'stale' }],
        [
          someField,
          {
            model: 'User',
            field: 'discordId',
            type: 'String',
            optional: false,
            defaultValue: null,
            doc: null,
          },
        ]
      )
    ).toThrow(/already been tightened/);
  });
});

describe('applySuppressions', () => {
  it('filters findings whose key matches a suppression entry', () => {
    const findings: AuditFinding[] = [
      {
        severity: 'HIGH',
        recipe: 'bimodal-writes',
        model: 'User',
        field: 'nsfwVerifiedAt',
        evidence: '...',
        fixShape: '...',
      },
      {
        severity: 'MEDIUM',
        recipe: 'read-mode-classification',
        model: 'User',
        field: 'defaultLlmConfigId',
        evidence: '...',
        fixShape: '...',
      },
    ];
    const filtered = applySuppressions(findings, [
      { key: 'User.nsfwVerifiedAt', reason: 'state machine' },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].field).toBe('defaultLlmConfigId');
  });

  it('returns the original list when no suppressions match', () => {
    const findings: AuditFinding[] = [
      {
        severity: 'HIGH',
        recipe: 'bimodal-writes',
        model: 'User',
        field: 'unrelated',
        evidence: '...',
        fixShape: '...',
      },
    ];
    expect(applySuppressions(findings, [])).toEqual(findings);
  });
});
