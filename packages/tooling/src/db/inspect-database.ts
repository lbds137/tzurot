/**
 * Database Inspector
 *
 * Provides visibility into database state that Prisma doesn't show:
 * - Tables and row counts
 * - Indexes (especially "protected" ones Prisma can't manage)
 * - Columns on specific tables
 * - Migration status
 */

import chalk from 'chalk';
import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

/**
 * Safely extract host from DATABASE_URL using URL parser
 * Handles edge cases that split() would miss
 */
function getDatabaseHost(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return 'unknown';
  }

  try {
    const url = new URL(databaseUrl);
    return url.host;
  } catch {
    // Fallback for malformed URLs
    return 'unknown';
  }
}

// Known drift patterns - indexes that Prisma can't represent in schema.prisma
// These are EXPECTED to exist but will show as "drift" if Prisma detects them
const PROTECTED_INDEXES = [
  {
    name: 'idx_memories_embedding',
    table: 'memories',
    description: 'IVFFlat vector index for similarity search (pgvector)',
    recreateSQL:
      'CREATE INDEX "idx_memories_embedding" ON "memories" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);',
  },
  {
    name: 'memories_chunk_group_id_idx',
    table: 'memories',
    description: 'Partial index for chunk retrieval (WHERE chunk_group_id IS NOT NULL)',
    recreateSQL: `CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id") WHERE "chunk_group_id" IS NOT NULL;`,
  },
];

interface IndexRow {
  indexname: string;
  indexdef: string;
  tablename: string;
}

interface TableRow {
  tablename: string;
  rowcount: bigint;
  size: string;
}

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  applied_steps_count: number;
}

type PrismaClient = ReturnType<typeof getPrismaClient>;

async function inspectIndexes(prisma: PrismaClient): Promise<void> {
  console.log(chalk.bold('\n📊 DATABASE INDEXES'));
  console.log('═'.repeat(70));

  const indexes = await prisma.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef, tablename
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `;

  // Group by table
  const byTable = new Map<string, IndexRow[]>();
  for (const idx of indexes) {
    const existing = byTable.get(idx.tablename) ?? [];
    existing.push(idx);
    byTable.set(idx.tablename, existing);
  }

  for (const [table, tableIndexes] of byTable) {
    console.log(chalk.cyan(`\n📁 ${table}`));
    for (const idx of tableIndexes) {
      const protected_ = PROTECTED_INDEXES.find(p => p.name === idx.indexname);
      if (protected_) {
        console.log(chalk.yellow(`  🛡️  ${idx.indexname} (PROTECTED - Prisma can't manage)`));
        console.log(chalk.dim(`      ${protected_.description}`));
      } else if (idx.indexname.endsWith('_pkey')) {
        console.log(`  🔑 ${idx.indexname}`);
      } else {
        console.log(`  📇 ${idx.indexname}`);
      }
    }
  }

  // Check for missing protected indexes
  console.log(chalk.bold('\n🛡️  PROTECTED INDEX STATUS'));
  console.log('─'.repeat(50));
  for (const protected_ of PROTECTED_INDEXES) {
    const exists = indexes.some(i => i.indexname === protected_.name);
    if (exists) {
      console.log(chalk.green(`  ✅ ${protected_.name} - EXISTS`));
    } else {
      console.log(chalk.red(`  ❌ ${protected_.name} - MISSING!`));
      console.log(chalk.dim(`     Recreate: ${protected_.recreateSQL}`));
    }
  }
}

async function inspectTables(prisma: PrismaClient): Promise<void> {
  console.log(chalk.bold('\n📊 DATABASE TABLES'));
  console.log('═'.repeat(70));

  const tables = await prisma.$queryRaw<TableRow[]>`
    SELECT
      relname as tablename,
      n_live_tup as rowcount,
      pg_size_pretty(pg_total_relation_size(relid)) as size
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
  `;

  console.log('\n  Table                              Rows        Size');
  console.log('  ' + '─'.repeat(55));
  for (const t of tables) {
    const name = t.tablename.padEnd(32);
    const rows = t.rowcount.toString().padStart(10);
    console.log(`  ${name} ${rows}   ${t.size}`);
  }
}

async function inspectTableDetails(prisma: PrismaClient, tableName: string): Promise<void> {
  console.log(chalk.bold(`\n📊 TABLE: ${tableName}`));
  console.log('═'.repeat(70));

  const columns = await prisma.$queryRaw<ColumnRow[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
    ORDER BY ordinal_position
  `;

  if (columns.length === 0) {
    console.log(chalk.red(`  ❌ Table '${tableName}' not found`));
    return;
  }

  console.log('\n  Column                           Type                 Nullable  Default');
  console.log('  ' + '─'.repeat(75));
  for (const c of columns) {
    const name = c.column_name.padEnd(32);
    const type = c.data_type.padEnd(20);
    const nullable = c.is_nullable === 'YES' ? 'YES' : 'NO ';
    const default_ = c.column_default ? c.column_default.substring(0, 20) : '-';
    console.log(`  ${name} ${type} ${nullable}       ${default_}`);
  }

  // Show indexes for this table
  const indexes = await prisma.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef, tablename
    FROM pg_indexes
    WHERE tablename = ${tableName}
    ORDER BY indexname
  `;

  console.log('\n  Indexes:');
  for (const idx of indexes) {
    const protected_ = PROTECTED_INDEXES.find(p => p.name === idx.indexname);
    const prefix = protected_ ? '🛡️ ' : '📇';
    console.log(`  ${prefix} ${idx.indexname}`);
    if (protected_) {
      console.log(chalk.dim(`      (Protected: ${protected_.description})`));
    }
  }
}

async function inspectMigrations(prisma: PrismaClient): Promise<void> {
  console.log(chalk.bold('\n📊 MIGRATION STATUS'));
  console.log('═'.repeat(70));

  const migrations = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, finished_at, applied_steps_count
    FROM _prisma_migrations
    ORDER BY started_at DESC
    LIMIT 10
  `;

  console.log('\n  Recent migrations (newest first):');
  console.log('  ' + '─'.repeat(60));
  for (const m of migrations) {
    const status = m.finished_at ? '✅' : '❌';
    const date = m.finished_at ? m.finished_at.toISOString().split('T')[0] : 'FAILED';
    console.log(`  ${status} ${date}  ${m.migration_name}`);
  }

  // Check for failed migrations
  const failed = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, finished_at, applied_steps_count
    FROM _prisma_migrations
    WHERE finished_at IS NULL
  `;

  if (failed.length > 0) {
    console.log(chalk.yellow('\n  ⚠️  FAILED MIGRATIONS:'));
    for (const f of failed) {
      console.log(`     - ${f.migration_name}`);
    }
    console.log('\n  To resolve:');
    console.log(chalk.cyan('    npx prisma migrate resolve --rolled-back "<name>"'));
    console.log(chalk.cyan('    npx prisma migrate resolve --applied "<name>"'));
  }
}

export interface InspectOptions {
  table?: string;
  indexes?: boolean;
}

export async function inspectDatabase(options: InspectOptions = {}): Promise<void> {
  const prisma = getPrismaClient();

  console.log(chalk.bold('🔍 DATABASE INSPECTOR'));
  console.log('═'.repeat(70));
  console.log(chalk.dim(`   Database: ${getDatabaseHost()}`));

  try {
    if (options.table !== undefined) {
      await inspectTableDetails(prisma, options.table);
    } else if (options.indexes === true) {
      await inspectIndexes(prisma);
    } else {
      // Default: show everything
      await inspectTables(prisma);
      await inspectIndexes(prisma);
      await inspectMigrations(prisma);
    }

    console.log('\n' + '═'.repeat(70));
    console.log(chalk.dim('💡 Tips:'));
    console.log(chalk.dim('   pnpm ops db:inspect --table <name>  Inspect specific table'));
    console.log(chalk.dim('   pnpm ops db:inspect --indexes       Show only indexes'));
    console.log('');
  } finally {
    await disconnectPrisma();
  }
}
