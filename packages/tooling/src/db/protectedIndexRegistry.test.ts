import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vol } from 'memfs';

// Mock fs with memfs
vi.mock('node:fs', async () => {
  const memfs = await import('memfs');
  return memfs.fs;
});

// The module under test resolves prisma/drift-ignore.json relative to its own
// file location (not process.cwd()) — see DEFAULT_DRIFT_IGNORE_PATH in
// protectedIndexRegistry.ts. Compute the identical absolute path here so the
// mocked memfs volume has a file at the exact location the loader will read.
const DRIFT_IGNORE_PATH = fileURLToPath(
  new URL('../../../../prisma/drift-ignore.json', import.meta.url)
);

/** A complete, real-shaped entry the tests mutate one field at a time. */
const GOOD_ENTRY = {
  name: 'idx_memories_embedding',
  table: 'memories',
  type: 'ivfflat',
  description: 'IVFFlat vector index for BGE embeddings (384 dims)',
  recreateSQL:
    'CREATE INDEX "idx_memories_embedding" ON "memories" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);',
  dropPattern: 'DROP\\s+INDEX.*idx_memories_embedding',
  createPattern: 'CREATE\\s+INDEX.*idx_memories_embedding',
};

/** Seed memfs with a drift-ignore.json whose protectedIndexes is `entries`. */
function seed(entries: unknown[]): void {
  vol.reset();
  vol.fromJSON({ [DRIFT_IGNORE_PATH]: JSON.stringify({ protectedIndexes: entries }) });
}

describe('protectedIndexRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
    vol.reset();
  });

  describe('happy path', () => {
    it('exposes every field each consumer reads, verbatim from the JSON', async () => {
      seed([GOOD_ENTRY]);

      const { PROTECTED_INDEX_ENTRIES } = await import('./protectedIndexRegistry.js');

      expect(PROTECTED_INDEX_ENTRIES).toEqual([
        {
          name: GOOD_ENTRY.name,
          table: GOOD_ENTRY.table,
          description: GOOD_ENTRY.description,
          recreateSQL: GOOD_ENTRY.recreateSQL,
          dropPattern: GOOD_ENTRY.dropPattern,
          createPattern: GOOD_ENTRY.createPattern,
        },
      ]);
    });

    it('preserves entry order, which inspect-database reports in', async () => {
      seed([
        { ...GOOD_ENTRY, name: 'idx_a', dropPattern: 'DROP idx_a', createPattern: 'CREATE idx_a' },
        { ...GOOD_ENTRY, name: 'idx_b', dropPattern: 'DROP idx_b', createPattern: 'CREATE idx_b' },
      ]);

      const { PROTECTED_INDEX_ENTRIES } = await import('./protectedIndexRegistry.js');

      expect(PROTECTED_INDEX_ENTRIES.map(e => e.name)).toEqual(['idx_a', 'idx_b']);
    });
  });

  describe('fail-loud validation', () => {
    // The registry computes its entries at import time, so a bad
    // drift-ignore.json must make the import itself reject rather than
    // silently handing a consumer zero protected indexes.

    it('throws when drift-ignore.json is missing entirely', async () => {
      vol.reset();

      await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(
        /could not read drift-ignore\.json/
      );
    });

    it('throws when drift-ignore.json is not valid JSON', async () => {
      vol.reset();
      vol.fromJSON({ [DRIFT_IGNORE_PATH]: '{ not valid json' });

      await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(/is not valid JSON/);
    });

    it('throws a named error when the file parses to bare null', async () => {
      vol.reset();
      vol.fromJSON({ [DRIFT_IGNORE_PATH]: 'null' });

      await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(/is not a JSON object/);
    });

    it('throws when protectedIndexes is an empty array', async () => {
      seed([]);

      await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(
        /empty or missing "protectedIndexes"/
      );
    });

    it('throws when protectedIndexes is missing from the file', async () => {
      vol.reset();
      vol.fromJSON({ [DRIFT_IGNORE_PATH]: JSON.stringify({ ignorePatterns: [] }) });

      await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(
        /empty or missing "protectedIndexes"/
      );
    });

    it('throws a named error when an entry is null rather than an object', async () => {
      seed([null]);

      await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(
        /protectedIndexes\[0\].*is not an object/s
      );
    });

    it.each([['name'], ['description'], ['dropPattern'], ['createPattern']])(
      'throws when an entry is missing %s entirely',
      async omitted => {
        const entry: Record<string, unknown> = { ...GOOD_ENTRY };
        delete entry[omitted];
        seed([entry]);

        await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(/is malformed/);
      }
    );

    it.each([['dropPattern'], ['createPattern']])(
      'rejects an empty %s — an empty pattern matches every file',
      async field => {
        seed([{ ...GOOD_ENTRY, [field]: '' }]);

        await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(
          /empty dropPattern or createPattern/
        );
      }
    );

    it.each([['name'], ['description']])(
      'rejects an empty %s — both are interpolated into the violation message',
      async field => {
        seed([{ ...GOOD_ENTRY, [field]: '' }]);

        await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(
          /empty name or description/
        );
      }
    );

    it('names the offending entry when a pattern is not a valid regex', async () => {
      seed([
        {
          ...GOOD_ENTRY,
          name: 'idx_unclosed_group',
          // Well-typed string, uncompilable pattern — the type checks above
          // pass, so only the compile guard catches this.
          dropPattern: 'DROP\\s+INDEX.*(idx_x',
        },
      ]);

      await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(
        /idx_unclosed_group.*not a valid regular expression/s
      );
    });

    it.each([['table'], ['recreateSQL']])(
      'rejects a missing %s — db:inspect reports it verbatim to an operator',
      async omitted => {
        const entry: Record<string, unknown> = { ...GOOD_ENTRY };
        delete entry[omitted];
        seed([entry]);

        await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(
          /missing or empty table or recreateSQL/
        );
      }
    );

    it.each([['table'], ['recreateSQL']])('rejects an empty %s', async field => {
      seed([{ ...GOOD_ENTRY, [field]: '' }]);

      await expect(import('./protectedIndexRegistry.js')).rejects.toThrow(
        /missing or empty table or recreateSQL/
      );
    });
  });
});
