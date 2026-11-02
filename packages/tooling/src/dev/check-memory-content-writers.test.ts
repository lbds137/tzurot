import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findContentWriterViolations,
  findContentWriters,
  isScannedSourceFile,
} from './check-memory-content-writers.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ALLOWLISTED_REL_PATH = 'services/api-gateway/src/routes/user/memorySingle.ts';

describe('isScannedSourceFile', () => {
  it('accepts production .ts files and skips tests, declarations, generated, and mocks', () => {
    expect(isScannedSourceFile('/repo/services/api-gateway/src/foo.ts')).toBe(true);
    expect(isScannedSourceFile('/repo/services/api-gateway/src/foo.tsx')).toBe(false);
    expect(isScannedSourceFile('/repo/services/api-gateway/src/foo.test.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/services/api-gateway/src/foo.spec.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/services/api-gateway/src/foo.d.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/packages/a/src/generated/client.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/services/a/src/__mocks__/db.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/services/a/node_modules/pkg/index.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/services/a/dist/index.ts')).toBe(false);
  });
});

describe('findContentWriters — flagged content writers', () => {
  it('flags prisma.memory.update with content: x', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      `await prisma.memory.update({ where: { id }, data: { content: x } });`
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.filePath).toBe('services/a/src/f.ts');
    expect(found[0]?.line).toBe(1);
  });

  it('flags prisma.memory.update with shorthand content', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      `await prisma.memory.update({ where: { id }, data: { content, updatedAt: new Date() } });`
    );
    expect(found).toHaveLength(1);
  });

  it('flags tx.memory.updateMany with content', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      `await tx.memory.updateMany({ where: { personaId }, data: { content: next } });`
    );
    expect(found).toHaveLength(1);
  });

  it('flags this.prisma.memory.update with content', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      `await this.prisma.memory.update({ where: { id }, data: { content: next } });`
    );
    expect(found).toHaveLength(1);
  });

  it('flags prisma.memory.upsert with content in update', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      'await prisma.memory.upsert({ where: { id }, create: { a: 1 }, update: { content: u } });'
    );
    expect(found).toHaveLength(1);
  });

  it('flags prisma.$executeRaw with UPDATE memories SET content = ...', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      'await prisma.$executeRaw`UPDATE memories SET content = ${next} WHERE id = ${id}::uuid`;'
    );
    expect(found).toHaveLength(1);
  });

  it('flags a plain string UPDATE memories SET a = 1, content = 2 WHERE id = 3', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      "const sql = 'UPDATE memories SET a = 1, content = 2 WHERE id = 3';"
    );
    expect(found).toHaveLength(1);
  });

  it('flags INSERT INTO memories ... ON CONFLICT (id) DO UPDATE SET content = ...', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      "const sql = 'INSERT INTO memories (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET content = 2';"
    );
    expect(found).toHaveLength(1);
  });

  it.each([
    'await prisma.memory.updateManyAndReturn({ where: { id }, data: { content: x } });',
    'await prisma.memory?.update({ data: { content: x } });',
    'await prisma.memory.update({ where: { id }, data: { content: x } as Prisma.MemoryUpdateInput });',
    "const sql = 'MERGE INTO memories m USING s ON true WHEN MATCHED THEN UPDATE SET content = 1';",
    "const sql = 'UPDATE ONLY memories SET content = 1';",
    "const sql = 'UPDATE memories AS m SET content = 1';",
    "const sql = 'UPDATE memories m SET a = 1, content = 2';",
    "const sql = 'UPDATE memories SET (a, content) = (1, 2)';",
    'prisma.persona.update({ where, data: { memories: { updateMany: { where: {}, data: { content: x } } } } })',
    'prisma.personality.update({ where, data: { memories: { update: { where: {}, data: { content: x } } } } })',
    'tx.persona.upsert({ where, create: {}, update: { memories: { upsert: [] } } })',
    'prisma.persona.update({ where, data: { memories: payload } })',
    'prisma.persona.update({ where, data: { memories } })',
    'prisma.persona.update({ where, data: { memories: { [key]: value } } })',
    'prisma.persona.update({ where, data: { memories: { update } } })',
    'prisma.persona.update({ where, data: { memories: { ...payload } } })',
    'prisma.memory!.update({ where: { id }, data: { content: x } })',
  ])('flags %s', src => {
    expect(findContentWriters('services/a/src/f.ts', src)).toHaveLength(1);
  });

  it('flags quoted table/column names and public.memories with RETURNING', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        'const sql = \'update public."memories" set "content" = $1 returning id\';'
      )
    ).toHaveLength(1);
  });
});

describe('findContentWriters — fail-closed unverifiable calls', () => {
  it('flags data: payload as unverifiable', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      'await prisma.memory.update({ where: { id }, data: payload });'
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toMatch(/cannot be verified/i);
  });

  it('flags data: payload as Prisma.MemoryUpdateInput as unverifiable', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      'await prisma.memory.update({ where: { id }, data: payload as Prisma.MemoryUpdateInput });'
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toMatch(/cannot be verified/i);
  });

  it('flags data: { ...payload } as unverifiable', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      'await prisma.memory.update({ where: { id }, data: { ...payload } });'
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toMatch(/cannot be verified/i);
  });

  it('flags update(args) as unverifiable', () => {
    const found = findContentWriters('services/a/src/f.ts', 'await prisma.memory.update(args);');
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toMatch(/cannot be verified/i);
  });

  it('flags computed key in data as unverifiable', () => {
    const found = findContentWriters(
      'services/a/src/f.ts',
      'await prisma.memory.update({ where: { id }, data: { [field]: val } });'
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toMatch(/cannot be verified/i);
  });
});

describe('findContentWriters — non-content writes not flagged', () => {
  it('does not flag prisma.memory.update with data: { visibility: "deleted" }', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        "await prisma.memory.update({ where: { id }, data: { visibility: 'deleted' } });"
      )
    ).toEqual([]);
  });

  it('does not flag prisma.memory.upsert with content only in create', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        'await prisma.memory.upsert({ where: { id }, create: { content: x }, update: { a: 1 } });'
      )
    ).toEqual([]);
  });

  it('does not flag prisma.memoryFact.update with content', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        'await prisma.memoryFact.update({ where: { id }, data: { content: x } });'
      )
    ).toEqual([]);
  });

  it('does not flag prisma.conversationHistory.update with content', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        'await prisma.conversationHistory.update({ where: { id }, data: { content: x } });'
      )
    ).toEqual([]);
  });

  it('does not flag UPDATE memories SET thinking_content = x', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        'await prisma.$executeRaw`UPDATE memories SET thinking_content = ${x} WHERE id = ${id}`;'
      )
    ).toEqual([]);
  });

  it.each([
    'await prisma.memory.update({ data: { a: 1 } }); await prisma.memoryFact.update({ data: { content: x } });',
    "await prisma.memory.update({ where: { id }, data: { visibility: 'a' } as Prisma.MemoryUpdateInput });",
    "await prisma.memory.update({ where: { id }, data: { visibility: 'a' } satisfies Prisma.MemoryUpdateInput });",
    'await prisma.memory.update({ where: { id }, data: { a: 1 } } as Args);',
    'await prisma.memory.update({ where: { id }, data: ({ a: 1 }) });',
    "const sql = 'UPDATE memories SET a = 1; UPDATE other SET content = 2';",
    "const sql = 'UPDATE memories m SET thinking_content = 1';",
    "const sql = 'UPDATE memories SET (a, thinking_content) = (1, 2)';",
    "const sql = 'UPDATE memories SET (a, content_hash) = (1, 2)';",
    "const sql = 'UPDATE memories SET (a, o.content) = (1, 2)';",
    "const sql = 'UPDATE memories m SET a = 1 FROM other JOIN x ON content = x.y WHERE m.id = 1';",
    'prisma.persona.update({ where, data: { memories: { connect: { id } } } })',
    'prisma.persona.update({ where, data: { memories: { deleteMany: {} } } })',
    'prisma.persona.update({ where, data: { name: x } })',
    'prisma.persona.upsert({ where, create: { memories: { create: [] } }, update: { name: x } })',
    'prisma.persona.update(args)',
    "const sql = 'INSERT INTO memories (id) VALUES (1); INSERT INTO other (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET content = 2';",
    "const sql = 'UPDATE memories m SET a = o.a FROM other o JOIN x ON o.content = x.y WHERE m.id = o.id';",
    "const sql = 'UPDATE memories m SET a = o.content = 1';",
  ])('does not flag %s', src => {
    expect(findContentWriters('services/a/src/f.ts', src)).toEqual([]);
  });

  it('does not flag UPDATE memories SET assistant_summary = x WHERE content = y', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        'await prisma.$executeRaw`UPDATE memories SET assistant_summary = ${x} WHERE content = ${y}`;'
      )
    ).toEqual([]);
  });

  it('does not flag UPDATE memories SET source_content_hash = x', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        'await prisma.$executeRaw`UPDATE memories SET source_content_hash = ${x} WHERE id = ${id}`;'
      )
    ).toEqual([]);
  });

  it('does not flag INSERT INTO memories (content) VALUES (x) ON CONFLICT (id) DO NOTHING', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        'sql`INSERT INTO memories (content) VALUES (${x}) ON CONFLICT (id) DO NOTHING`;'
      )
    ).toEqual([]);
  });

  it('does not flag UPDATE memory_facts SET content = x', () => {
    expect(
      findContentWriters(
        'services/a/src/f.ts',
        'await prisma.$executeRaw`UPDATE memory_facts SET content = ${x} WHERE id = ${id}`;'
      )
    ).toEqual([]);
  });
});

describe('positive control and repository scan', () => {
  it('returns 1 finding on the real services/api-gateway/src/routes/user/memorySingle.ts', () => {
    const fullPath = join(REPO_ROOT, ALLOWLISTED_REL_PATH);
    const sourceText = readFileSync(fullPath, 'utf-8');
    const findings = findContentWriters(ALLOWLISTED_REL_PATH, sourceText);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.filePath).toBe(ALLOWLISTED_REL_PATH);
  });

  // Deliberate second tripwire beside the CI step; a canary on the allowlist relies on it.
  it('returns no violations over the real repo root', () => {
    expect(findContentWriterViolations(REPO_ROOT)).toEqual([]);
  });
});

describe('findContentWriterViolations — temp tree', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'guard-memory-writers-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const full = join(tmp, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  it('reports a content writer outside the allowlist', () => {
    write(
      ALLOWLISTED_REL_PATH,
      `await prisma.memory.update({ where: { id }, data: { content, assistantSummary: null } });\n`
    );
    write(
      'services/other/src/rogue.ts',
      `await prisma.memory.update({ where: { id }, data: { content: 'new' } });\n`
    );

    const violations = findContentWriterViolations(tmp);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.filePath).toBe('services/other/src/rogue.ts');
  });

  it('reports nothing when only the allowlisted path has its expected writer', () => {
    write(
      ALLOWLISTED_REL_PATH,
      `await prisma.memory.update({ where: { id }, data: { content, assistantSummary: null } });\n`
    );
    write(
      'packages/a/src/clean.ts',
      `await prisma.memory.update({ where: { id }, data: { visibility: 'deleted' } });\n`
    );

    expect(findContentWriterViolations(tmp)).toEqual([]);
  });

  it('reports the allowlisted path when it has no content writer', () => {
    write(
      ALLOWLISTED_REL_PATH,
      `await prisma.memory.update({ where: { id }, data: { isLocked: true } });\n`
    );

    const violations = findContentWriterViolations(tmp);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.filePath).toBe(ALLOWLISTED_REL_PATH);
  });

  it('reports the allowlisted path when it has 2 content writers', () => {
    write(
      ALLOWLISTED_REL_PATH,
      [
        `await prisma.memory.update({ where: { id }, data: { content, assistantSummary: null } });`,
        `await prisma.memory.update({ where: { id }, data: { content: 'second', assistantSummary: null } });`,
      ].join('\n')
    );

    const violations = findContentWriterViolations(tmp);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.filePath).toBe(ALLOWLISTED_REL_PATH);
  });

  it('ignores writers in .test.ts and src/generated/ when the allowlisted path has its expected one writer', () => {
    write(
      ALLOWLISTED_REL_PATH,
      `await prisma.memory.update({ where: { id }, data: { content, assistantSummary: null } });\n`
    );
    write(
      'services/other/src/rogue.test.ts',
      `await prisma.memory.update({ where: { id }, data: { content: 'test' } });\n`
    );
    write(
      'services/other/src/generated/client.ts',
      `await prisma.memory.update({ where: { id }, data: { content: 'gen' } });\n`
    );

    expect(findContentWriterViolations(tmp)).toEqual([]);
  });

  it('reports a writer outside the allowlist when rootDir contains a dist directory', () => {
    write(
      `dist/${ALLOWLISTED_REL_PATH}`,
      `await prisma.memory.update({ where: { id }, data: { content, assistantSummary: null } });\n`
    );
    write(
      'dist/services/other/src/rogue.ts',
      `await prisma.memory.update({ where: { id }, data: { content: 'new' } });\n`
    );

    const violations = findContentWriterViolations(join(tmp, 'dist'));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.filePath).toBe('services/other/src/rogue.ts');
  });
});
