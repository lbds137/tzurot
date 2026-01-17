/**
 * Quick check of embedding state in production
 */
import 'dotenv/config';
import { getPrismaClient } from '@tzurot/common-types';

const prisma = getPrismaClient();

async function main() {
  // Check column structure
  const cols = await prisma.$queryRaw<
    { column_name: string; data_type: string; udt_name: string }[]
  >`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name LIKE '%embedding%'
  `;
  console.log('Columns:', JSON.stringify(cols, null, 2));

  // Check actual data - how many have non-null embeddings?
  const stats = await prisma.$queryRaw<
    { total: bigint; with_embedding: bigint; without_embedding: bigint }[]
  >`
    SELECT
      COUNT(*) as total,
      COUNT(embedding) as with_embedding,
      COUNT(*) - COUNT(embedding) as without_embedding
    FROM memories
  `;
  console.log(
    'Stats:',
    JSON.stringify(
      stats.map(s => ({
        total: Number(s.total),
        with_embedding: Number(s.with_embedding),
        without_embedding: Number(s.without_embedding),
      })),
      null,
      2
    )
  );

  // Check a sample embedding - what dimension is it?
  const sample = await prisma.$queryRaw<{ id: string; dims: number }[]>`
    SELECT id, vector_dims(embedding) as dims
    FROM memories
    WHERE embedding IS NOT NULL
    LIMIT 1
  `;
  console.log('Sample embedding dimensions:', JSON.stringify(sample, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
