import { PGVECTOR_SEARCH } from '../constants/pgvector.js';
import type { Prisma, PrismaClient } from './prisma.js';

/**
 * Run a pgvector similarity query with exact-recall IVFFlat settings.
 *
 * `set_config(..., true)` is transaction-local (SET LOCAL), so it and the query
 * run in ONE `$transaction` batch on the same connection; the setting ends with
 * the transaction and does not leak to other queries on the pooled connection
 * (probed on dev through the driver adapter with a one-connection pool: SHOW
 * inside the batch returned the set value, a later query returned 1). Unit
 * test `vectorSearch.test.ts` pins only the ordering within one `$transaction`.
 * Every `<=>` query site goes through this helper.
 */
export async function queryRawWithExactVectorSearch<T>(
  prisma: PrismaClient,
  query: Prisma.Sql
): Promise<T> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('ivfflat.probes', ${String(PGVECTOR_SEARCH.IVFFLAT_PROBES)}, true)`,
    prisma.$queryRaw<T>(query),
  ]);
  return rows;
}
