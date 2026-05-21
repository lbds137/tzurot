/**
 * Tests for Prisma schema parsing.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePrismaSchema } from './schema-audit-parser.js';

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
  emailHint  String?
  verifiedAt DateTime?
}
`
      );

      const fields = parsePrismaSchema(schemaPath);
      const userFields = fields.filter(f => f.model === 'User');
      expect(userFields).toHaveLength(4);

      const emailHint = userFields.find(f => f.field === 'emailHint');
      expect(emailHint).toEqual(
        expect.objectContaining({
          model: 'User',
          field: 'emailHint',
          type: 'String',
          optional: true,
          defaultValue: null,
        })
      );

      const id = userFields.find(f => f.field === 'id');
      expect(id?.optional).toBe(false);
    });
  });

  it('extracts @default values, including generator-style nested parens', () => {
    withTempDir(dir => {
      const schemaPath = join(dir, 'schema.prisma');
      writeFileSync(
        schemaPath,
        `
model Personality {
  id         String   @id @db.Uuid
  provider   String   @default("openrouter")
  isDefault  Boolean  @default(false)
  createdAt  DateTime @default(now())
}
`
      );

      const fields = parsePrismaSchema(schemaPath);
      expect(fields.find(f => f.field === 'provider')?.defaultValue).toBe('"openrouter"');
      expect(fields.find(f => f.field === 'isDefault')?.defaultValue).toBe('false');
      expect(fields.find(f => f.field === 'createdAt')?.defaultValue).toBe('now()');
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
