/**
 * Tests for the `audit.config.ts/.json` suppression mechanism.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadAuditConfig,
  validateSuppressions,
  applySuppressions,
} from './schema-audit-suppression.js';
import type { PrismaField } from './schema-audit-parser.js';
import type { AuditFinding } from './schema-audit-findings.js';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'schema-audit-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
