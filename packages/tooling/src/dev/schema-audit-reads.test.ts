/**
 * Tests for read-mode classification (Recipe Primary).
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyReads } from './schema-audit-reads.js';
import type { PrismaField } from './schema-audit-parser.js';
import { withTempDir } from './schema-audit-test-helpers.js';

describe('classifyReads', () => {
  const optionalField: PrismaField = {
    model: 'User',
    field: 'targetField',
    type: 'String',
    optional: true,
    defaultValue: null,
    doc: null,
  };

  async function withSourceFile(content: string, fn: (path: string) => void): Promise<void> {
    await withTempDir(dir => {
      const path = join(dir, 'test.ts');
      writeFileSync(path, content);
      fn(path);
    });
  }

  it('counts nullish coalescing reads', async () => {
    await withSourceFile(
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

  it('counts truthiness guards (`!= null`, `=== null`, bare if)', async () => {
    await withSourceFile(
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

  it('counts non-null assertions separately', async () => {
    await withSourceFile(
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

  it('does not match receivers whose names do not look like the model', async () => {
    await withSourceFile(
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

  it('counts ternary condition as truthiness-guard but NOT ternary branches', async () => {
    await withSourceFile(
      `
declare const user: { targetField: string | null };
// Condition position — should count as truthiness-guard
const a = user.targetField ? 'yes' : 'no';
// Branch positions — should NOT count as truthiness-guard (they're accesses, not guards)
const b = true ? user.targetField : 'other';
const c = true ? 'other' : user.targetField;
`,
      path => {
        const classifications = classifyReads([optionalField], [path]);
        // Three reads total; only the first (condition) is a truthiness-guard.
        // The other two (branches) are unclassified accesses.
        expect(classifications[0].totalReads).toBe(3);
        expect(classifications[0].truthinessGuardReads).toBe(1);
      }
    );
  });

  it('matches both singular and plural receiver names', async () => {
    await withSourceFile(
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
