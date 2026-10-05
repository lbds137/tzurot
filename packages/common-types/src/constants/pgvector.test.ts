import { describe, it, expect } from 'vitest';
import { PGVECTOR_SEARCH } from './pgvector.js';

describe('PGVECTOR_SEARCH', () => {
  it('sets ivfflat.probes to the GUC maximum', () => {
    expect(PGVECTOR_SEARCH.IVFFLAT_PROBES).toBe(32768);
  });

  it('is at least the lists of both IVFFlat indexes (50, see PRISMA_PGVECTOR_REFERENCE.md)', () => {
    expect(PGVECTOR_SEARCH.IVFFLAT_PROBES).toBeGreaterThanOrEqual(50);
  });
});
