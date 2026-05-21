/**
 * Tests for the schema-audit entry point — end-to-end smoke verifying
 * runSchemaAudit composes parser + classifier + finding generator +
 * suppression mechanism into a coherent CLI flow.
 *
 * Per-module unit tests live in the sibling `schema-audit-*.test.ts` files.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSchemaAudit } from './schema-audit.js';

function withTempProject(fn: (root: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'schema-audit-e2e-'));
  return Promise.resolve(fn(dir)).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

function captureStdout(): { output: () => string; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = vi.fn((...args: unknown[]) => {
    lines.push(args.map(a => String(a)).join(' '));
  });
  return {
    output: () => lines.join('\n'),
    restore: () => {
      console.log = original;
    },
  };
}

describe('runSchemaAudit (entry-point smoke)', () => {
  it('runs end-to-end against a synthetic schema + source tree and emits markdown', async () => {
    await withTempProject(async root => {
      // Synthetic schema with one optional field.
      mkdirSync(join(root, 'prisma'));
      writeFileSync(
        join(root, 'prisma', 'schema.prisma'),
        `
model User {
  id        String  @id @db.Uuid
  discordId String  @unique
  someField String?
}
`
      );
      // Source tree with no read/write sites — the audit should run cleanly
      // and report 0 findings.
      mkdirSync(join(root, 'services'));
      writeFileSync(join(root, 'services', 'noop.ts'), 'export const x = 1;\n');

      const capture = captureStdout();
      try {
        await runSchemaAudit({ repoRoot: root, format: 'markdown' });
      } finally {
        capture.restore();
      }
      const markdownOutput = capture.output();
      expect(markdownOutput).toContain('# Schema Audit Report');
      expect(markdownOutput).toContain('**Findings**: 0');
    });
  });

  it('emits JSON when format=json is passed', async () => {
    await withTempProject(async root => {
      mkdirSync(join(root, 'prisma'));
      writeFileSync(
        join(root, 'prisma', 'schema.prisma'),
        `
model User {
  id String @id @db.Uuid
}
`
      );
      mkdirSync(join(root, 'services'));
      writeFileSync(join(root, 'services', 'noop.ts'), 'export const x = 1;\n');

      const capture = captureStdout();
      try {
        await runSchemaAudit({ repoRoot: root, format: 'json' });
      } finally {
        capture.restore();
      }
      const output = capture.output();
      const parsed = JSON.parse(output) as { stats: { totalFields: number } };
      expect(parsed.stats.totalFields).toBeGreaterThan(0);
    });
  });
});
