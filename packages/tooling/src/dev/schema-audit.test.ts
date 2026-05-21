/**
 * Tests for the schema-audit entry point — end-to-end smoke verifying
 * runSchemaAudit composes parser + classifier + finding generator +
 * suppression mechanism into a coherent CLI flow.
 *
 * Per-module unit tests live in the sibling `schema-audit-*.test.ts` files.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runSchemaAudit } from './schema-audit.js';
import { withTempDir } from './schema-audit-test-helpers.js';

// Local alias: e2e tests describe `dir` as "the project root" for readability.
const withTempProject = withTempDir;

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
  afterEach(() => {
    // runSchemaAudit mutates process.exitCode — reset between tests so
    // ordering doesn't carry state across cases.
    process.exitCode = 0;
  });

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

  it('produces a finding when synthetic source triggers a recipe', async () => {
    await withTempProject(async root => {
      mkdirSync(join(root, 'prisma'));
      writeFileSync(
        join(root, 'prisma', 'schema.prisma'),
        `
model User {
  id        String  @id @db.Uuid
  someField String?
}
`
      );
      mkdirSync(join(root, 'services'));
      // Two consumers each use `?? fallback` against `user.someField`. The
      // matchesModel heuristic lowercases the receiver name, so the variable
      // must be named `user` (or `users`) to match the `User` model.
      // 2/2 ??-reads → coalescingShare 1.0 → MEDIUM convenience-nullable.
      writeFileSync(
        join(root, 'services', 'consumer-a.ts'),
        `
type User = { someField: string | null };
export function fmtA(user: User): string {
  return user.someField ?? 'fallback-a';
}
`
      );
      writeFileSync(
        join(root, 'services', 'consumer-b.ts'),
        `
type User = { someField: string | null };
export function fmtB(user: User): string {
  return user.someField ?? 'fallback-b';
}
`
      );

      const capture = captureStdout();
      try {
        await runSchemaAudit({ repoRoot: root, format: 'markdown' });
      } finally {
        capture.restore();
      }
      const markdownOutput = capture.output();
      expect(markdownOutput).toContain('User.someField');
      expect(markdownOutput).toContain('read-mode-classification');
      expect(markdownOutput).toMatch(/\*\*Findings\*\*: [1-9]/);
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
      const parsed = JSON.parse(output) as {
        stats: { totalFields: number; suppressedCount: number; findings: number };
        findings: unknown;
      };
      expect(parsed.stats.totalFields).toBeGreaterThan(0);
      expect(parsed.stats).toHaveProperty('suppressedCount');
      expect(parsed.stats).toHaveProperty('findings');
      expect(Array.isArray(parsed.findings)).toBe(true);
    });
  });
});
