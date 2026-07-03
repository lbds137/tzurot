/**
 * Tests for the docs-orphan scan. Pure function over a temp repo layout —
 * no mocked fs, since the scan's whole job is directory traversal + content
 * matching and a memfs stand-in would test the mock, not the walk.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDocsOrphans } from './docs-orphan-scan.js';

async function withRepo(
  files: Record<string, string>,
  run: (repoRoot: string) => Promise<void>
): Promise<void> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'docs-orphan-test-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const full = join(repoRoot, relPath);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content);
    }
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

describe('scanDocsOrphans', () => {
  it('flags reference docs no other markdown mentions', async () => {
    await withRepo(
      {
        'docs/reference/linked-guide.md': '# Linked guide',
        'docs/reference/nested/orphan-runbook.md': '# Nobody links here',
        'README.md': 'See [the guide](docs/reference/linked-guide.md) for setup.',
      },
      async repoRoot => {
        const result = scanDocsOrphans(repoRoot);

        expect(result.totalDocs).toBe(2);
        expect(result.orphans).toEqual(['docs/reference/nested/orphan-runbook.md']);
      }
    );
  });

  it('does not count a doc mentioning its own name as an inbound link', async () => {
    await withRepo(
      {
        'docs/reference/self-referential-doc.md':
          '# Self\nThis file is self-referential-doc.md and mentions itself.',
      },
      async repoRoot => {
        expect(scanDocsOrphans(repoRoot).orphans).toEqual([
          'docs/reference/self-referential-doc.md',
        ]);
      }
    );
  });

  it('accepts an inbound link from another reference doc', async () => {
    await withRepo(
      {
        'docs/reference/parent-index.md': 'Details live in [child](./child-details.md).',
        'docs/reference/child-details.md': '# Child',
        'BACKLOG.md': 'Track parent-index cleanup.',
      },
      async repoRoot => {
        expect(scanDocsOrphans(repoRoot).orphans).toEqual([]);
      }
    );
  });

  it('requires the basename as a standalone token, not a substring', async () => {
    await withRepo(
      {
        'docs/reference/cache-audit.md': '# Cache audit',
        // "precache-audits" contains the slug only as a substring — the
        // word-boundary matcher must not treat it as an inbound link.
        'README.md': 'We run precache-audits tooling here.',
      },
      async repoRoot => {
        expect(scanDocsOrphans(repoRoot).orphans).toEqual(['docs/reference/cache-audit.md']);
      }
    );
  });

  it('ignores mentions inside vendored/build trees like node_modules', async () => {
    await withRepo(
      {
        'docs/reference/vendored-only.md': '# Only vendored code mentions this',
        'node_modules/some-dep/README.md': 'Mentions vendored-only here.',
      },
      async repoRoot => {
        expect(scanDocsOrphans(repoRoot).orphans).toEqual(['docs/reference/vendored-only.md']);
      }
    );
  });

  it('returns an empty result when docs/reference does not exist', async () => {
    await withRepo({ 'README.md': 'no docs tree at all' }, async repoRoot => {
      expect(scanDocsOrphans(repoRoot)).toEqual({ totalDocs: 0, orphans: [] });
    });
  });
});
