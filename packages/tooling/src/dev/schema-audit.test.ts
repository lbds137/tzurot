/**
 * Schema Audit Tool — Tests
 *
 * Tests for milestone-1 components: schema parsing + read-mode classification.
 *
 * Milestone-2 tests (bimodal-writes, refined Recipe A, suppression) added later.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePrismaSchema,
  classifyReads,
  analyzeWrites,
  generateFindings,
  loadAuditConfig,
  validateSuppressions,
  applySuppressions,
  type AuditFinding,
  type PrismaField,
} from './schema-audit.js';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'schema-audit-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('parsePrismaSchema', () => {
  it('extracts model + field + type + optional flag', () => {
    withTempDir(dir => {
      const schemaPath = join(dir, 'schema.prisma');
      writeFileSync(
        schemaPath,
        `
generator client {
  provider = "prisma-client-js"
}

model User {
  id         String  @id @db.Uuid
  discordId  String  @unique
  email      String?
  verifiedAt DateTime?
}
`
      );

      const fields = parsePrismaSchema(schemaPath);
      const userFields = fields.filter(f => f.model === 'User');
      expect(userFields).toHaveLength(4);

      const email = userFields.find(f => f.field === 'email');
      expect(email).toEqual(
        expect.objectContaining({
          model: 'User',
          field: 'email',
          type: 'String',
          optional: true,
          defaultValue: null,
        })
      );

      const id = userFields.find(f => f.field === 'id');
      expect(id?.optional).toBe(false);
    });
  });

  it('extracts @default values', () => {
    withTempDir(dir => {
      const schemaPath = join(dir, 'schema.prisma');
      writeFileSync(
        schemaPath,
        `
model Personality {
  id         String  @id @db.Uuid
  provider   String  @default("openrouter")
  isDefault  Boolean @default(false)
  createdAt  DateTime @default(now())
}
`
      );

      const fields = parsePrismaSchema(schemaPath);
      const provider = fields.find(f => f.field === 'provider');
      expect(provider?.defaultValue).toBe('"openrouter"');

      const isDefault = fields.find(f => f.field === 'isDefault');
      expect(isDefault?.defaultValue).toBe('false');

      const createdAt = fields.find(f => f.field === 'createdAt');
      expect(createdAt?.defaultValue).toBe('now()');
    });
  });

  it('captures triple-slash documentation immediately above a field', () => {
    withTempDir(dir => {
      const schemaPath = join(dir, 'schema.prisma');
      writeFileSync(
        schemaPath,
        `
model User {
  id String @id @db.Uuid
  /// User-level STT provider override written by /voice stt set.
  /// When NULL, transcription derives from the user's default TTS provider.
  defaultSttProviderId String? @db.VarChar(20)
  someOtherField String
}
`
      );

      const fields = parsePrismaSchema(schemaPath);
      const stt = fields.find(f => f.field === 'defaultSttProviderId');
      expect(stt?.doc).toBe(
        "User-level STT provider override written by /voice stt set. When NULL, transcription derives from the user's default TTS provider."
      );

      // Doc above a field does NOT bleed to the next field.
      const other = fields.find(f => f.field === 'someOtherField');
      expect(other?.doc).toBeNull();
    });
  });

  it('skips block-level directives (@@unique, @@index, @@map)', () => {
    withTempDir(dir => {
      const schemaPath = join(dir, 'schema.prisma');
      writeFileSync(
        schemaPath,
        `
model User {
  id        String @id @db.Uuid
  discordId String @unique

  @@index([discordId])
  @@map("users")
}
`
      );

      const fields = parsePrismaSchema(schemaPath);
      const userFields = fields.filter(f => f.model === 'User');
      expect(userFields.map(f => f.field)).toEqual(['id', 'discordId']);
    });
  });
});

describe('classifyReads', () => {
  const optionalField: PrismaField = {
    model: 'User',
    field: 'targetField',
    type: 'String',
    optional: true,
    defaultValue: null,
    doc: null,
  };

  function withSourceFile(content: string, fn: (path: string) => void): void {
    withTempDir(dir => {
      const path = join(dir, 'test.ts');
      writeFileSync(path, content);
      fn(path);
    });
  }

  it('counts nullish coalescing reads', () => {
    withSourceFile(
      `
declare const user: { targetField: string | null };
const x = user.targetField ?? 'fallback';
const y = user.targetField ?? 'another-fallback';
`,
      path => {
        const classifications = classifyReads([optionalField], [path]);
        expect(classifications[0].nullishCoalescingReads).toBe(2);
        expect(classifications[0].truthinessGuardReads).toBe(0);
      }
    );
  });

  it('counts truthiness guards (`!= null`, `=== null`, bare if)', () => {
    withSourceFile(
      `
declare const user: { targetField: string | null };
if (user.targetField !== null) { console.log('a'); }
if (user.targetField === null) { console.log('b'); }
if (user.targetField) { console.log('c'); }
`,
      path => {
        const classifications = classifyReads([optionalField], [path]);
        expect(classifications[0].truthinessGuardReads).toBe(3);
        expect(classifications[0].nullishCoalescingReads).toBe(0);
      }
    );
  });

  it('counts non-null assertions separately', () => {
    withSourceFile(
      `
declare const user: { targetField: string | null };
const x = user.targetField!.length;
`,
      path => {
        const classifications = classifyReads([optionalField], [path]);
        expect(classifications[0].nonNullAssertionReads).toBe(1);
      }
    );
  });

  it('does not match receivers whose names do not look like the model', () => {
    withSourceFile(
      `
declare const someUnrelated: { targetField: string | null };
const x = someUnrelated.targetField ?? 'fallback';
`,
      path => {
        const classifications = classifyReads([optionalField], [path]);
        expect(classifications[0].totalReads).toBe(0);
      }
    );
  });

  it('matches both singular and plural receiver names', () => {
    withSourceFile(
      `
declare const user: { targetField: string | null };
declare const users: { targetField: string | null }[];
const x = user.targetField ?? 'a';
const y = users[0].targetField ?? 'b';
`,
      path => {
        const classifications = classifyReads([optionalField], [path]);
        // 'user' matches; 'users[0]' has receiver 'users[0]' as ElementAccess
        // which Node.isIdentifier rejects. Only the first read matches.
        expect(classifications[0].nullishCoalescingReads).toBe(1);
      }
    );
  });
});

describe('generateFindings', () => {
  const field: PrismaField = {
    model: 'User',
    field: 'someField',
    type: 'String',
    optional: true,
    defaultValue: null,
    doc: null,
  };

  it('flags MEDIUM when >50% of reads are `?? fallback`', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 8,
          truthinessGuardReads: 2,
          nonNullAssertionReads: 0,
          totalReads: 10,
        },
      ],
      [],
      [field]
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
    expect(findings[0].recipe).toBe('read-mode-classification');
  });

  it('does NOT flag when reads are dominantly truthiness-guards (state machine)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 1,
          truthinessGuardReads: 8,
          nonNullAssertionReads: 0,
          totalReads: 9,
        },
      ],
      [],
      [field]
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag when the split is ambiguous (e.g., 50/50)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 1,
          truthinessGuardReads: 1,
          nonNullAssertionReads: 0,
          totalReads: 2,
        },
      ],
      [],
      [field]
    );
    // Ambiguous signal — don't flag (conservative).
    expect(findings).toHaveLength(0);
  });

  it('flags HIGH when >50% of reads are non-null assertions (fake-optional)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 0,
          truthinessGuardReads: 0,
          nonNullAssertionReads: 5,
          totalReads: 5,
        },
      ],
      [],
      [field]
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('HIGH');
  });

  it('does NOT flag fields without reads (zero-divisor and zero-signal both safe)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 0,
          truthinessGuardReads: 0,
          nonNullAssertionReads: 0,
          totalReads: 0,
        },
      ],
      [],
      [field]
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag fields that are not optional in the schema (sanity)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'requiredField',
          nullishCoalescingReads: 10,
          truthinessGuardReads: 0,
          nonNullAssertionReads: 0,
          totalReads: 10,
        },
      ],
      [],
      [
        {
          model: 'User',
          field: 'requiredField',
          type: 'String',
          optional: false,
          defaultValue: null,
          doc: null,
        },
      ]
    );
    expect(findings).toHaveLength(0);
  });
});

describe('analyzeWrites', () => {
  const field: PrismaField = {
    model: 'User',
    field: 'targetField',
    type: 'String',
    optional: true,
    defaultValue: null,
    doc: null,
  };

  function withSourceFile(content: string, fn: (path: string) => void): void {
    withTempDir(dir => {
      const path = join(dir, 'test.ts');
      writeFileSync(path, content);
      fn(path);
    });
  }

  it('classifies `field: null` literal as null-set', () => {
    withSourceFile(
      `
declare const prisma: { user: { create: (args: unknown) => unknown } };
prisma.user.create({ data: { targetField: null, discordId: 'x' } });
`,
      path => {
        const classifications = analyzeWrites([field], [path]);
        expect(classifications[0].nullLiteralSites).toBe(1);
        expect(classifications[0].valueSites).toBe(0);
      }
    );
  });

  it('classifies `field: someValue` as value-set', () => {
    withSourceFile(
      `
declare const prisma: { user: { create: (args: unknown) => unknown } };
declare const id: string;
prisma.user.create({ data: { targetField: id, discordId: 'x' } });
`,
      path => {
        const classifications = analyzeWrites([field], [path]);
        expect(classifications[0].valueSites).toBe(1);
      }
    );
  });

  it('classifies omitted field as omitted-set', () => {
    withSourceFile(
      `
declare const prisma: { user: { create: (args: unknown) => unknown } };
prisma.user.create({ data: { discordId: 'x' } });
`,
      path => {
        const classifications = analyzeWrites([field], [path]);
        expect(classifications[0].omittedSites).toBe(1);
      }
    );
  });

  it('classifies sites with spread as unclassifiable when field is absent', () => {
    withSourceFile(
      `
declare const prisma: { user: { create: (args: unknown) => unknown } };
declare const partial: { discordId: string };
prisma.user.create({ data: { ...partial } });
`,
      path => {
        const classifications = analyzeWrites([field], [path]);
        expect(classifications[0].unclassifiableSites).toBe(1);
      }
    );
  });

  it('handles upsert by reading the `create` block', () => {
    withSourceFile(
      `
declare const prisma: { user: { upsert: (args: unknown) => unknown } };
prisma.user.upsert({
  where: { id: '1' },
  create: { targetField: null, discordId: 'x' },
  update: {},
});
`,
      path => {
        const classifications = analyzeWrites([field], [path]);
        expect(classifications[0].nullLiteralSites).toBe(1);
      }
    );
  });

  it('aggregates across multiple sites in one file', () => {
    withSourceFile(
      `
declare const prisma: { user: { create: (args: unknown) => unknown } };
declare const id: string;
prisma.user.create({ data: { targetField: null, discordId: 'a' } });
prisma.user.create({ data: { targetField: null, discordId: 'b' } });
prisma.user.create({ data: { targetField: id, discordId: 'c' } });
prisma.user.create({ data: { targetField: id, discordId: 'd' } });
`,
      path => {
        const classifications = analyzeWrites([field], [path]);
        expect(classifications[0].nullLiteralSites).toBe(2);
        expect(classifications[0].valueSites).toBe(2);
        expect(classifications[0].totalSites).toBe(4);
      }
    );
  });
});

describe('bimodal-writes recipe', () => {
  const field: PrismaField = {
    model: 'User',
    field: 'someField',
    type: 'String',
    optional: true,
    defaultValue: null,
    doc: null,
  };

  it('flags HIGH when writes split bimodally (>=2 null/omit + >=2 value)', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 2,
          valueSites: 3,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [field]
    );
    const bimodal = findings.filter(f => f.recipe === 'bimodal-writes');
    expect(bimodal).toHaveLength(1);
    expect(bimodal[0].severity).toBe('HIGH');
  });

  it('does NOT flag when only one cluster present (e.g., all value)', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 0,
          valueSites: 5,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [field]
    );
    expect(findings.filter(f => f.recipe === 'bimodal-writes')).toHaveLength(0);
  });

  it('counts null and omit toward the same cluster', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 1,
          valueSites: 3,
          omittedSites: 1, // 1 null + 1 omit = 2 → bimodal threshold met
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [field]
    );
    expect(findings.filter(f => f.recipe === 'bimodal-writes')).toHaveLength(1);
  });
});

describe('always-passed-no-default recipe', () => {
  it('flags MEDIUM when all writes pass a value and no @default applies', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 0,
          valueSites: 5,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [
        {
          model: 'User',
          field: 'someField',
          type: 'String',
          optional: true,
          defaultValue: null,
          doc: null,
        },
      ]
    );
    const t = findings.filter(f => f.recipe === 'always-passed-no-default');
    expect(t).toHaveLength(1);
    expect(t[0].severity).toBe('MEDIUM');
  });

  it('does NOT flag when @default is a generator (callers expected to omit)', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'id',
          nullLiteralSites: 0,
          valueSites: 5,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [
        {
          model: 'User',
          field: 'id',
          type: 'String',
          optional: true,
          defaultValue: 'uuid()',
          doc: null,
        },
      ]
    );
    expect(findings.filter(f => f.recipe === 'always-passed-no-default')).toHaveLength(0);
  });

  it('does NOT flag when any site is null/omit (bimodal-writes territory)', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 1,
          valueSites: 5,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 6,
        },
      ],
      [
        {
          model: 'User',
          field: 'someField',
          type: 'String',
          optional: true,
          defaultValue: null,
          doc: null,
        },
      ]
    );
    expect(findings.filter(f => f.recipe === 'always-passed-no-default')).toHaveLength(0);
  });
});

describe('audit.config.ts suppression', () => {
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
});
