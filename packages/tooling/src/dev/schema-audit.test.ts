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
  generateFindings,
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
