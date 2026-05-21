/**
 * Tests for write-site classification (powers Recipes Secondary + Tertiary).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeWrites } from './schema-audit-writes.js';
import type { PrismaField } from './schema-audit-parser.js';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'schema-audit-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

  it('classifies `field: expr ?? null` as null-set (nullable-fallback pattern)', () => {
    withSourceFile(
      `
declare const prisma: { user: { create: (args: unknown) => unknown } };
declare const maybeId: string | null;
prisma.user.create({ data: { targetField: maybeId ?? null, discordId: 'x' } });
prisma.user.create({ data: { targetField: maybeId ?? undefined, discordId: 'y' } });
prisma.user.create({ data: { targetField: maybeId || null, discordId: 'z' } });
`,
      path => {
        const classifications = analyzeWrites([field], [path]);
        // All 3 sites use a nullable-fallback pattern → null-set.
        expect(classifications[0].nullLiteralSites).toBe(3);
        expect(classifications[0].valueSites).toBe(0);
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
