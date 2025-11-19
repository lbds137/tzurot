import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

async function verifyChecksums() {
  console.log('Checking migration checksums...\n');

  const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

  const dbMigrations = await prisma.$queryRaw<Array<{
    migration_name: string;
    checksum: string;
    applied_steps_count: number;
  }>>`
    SELECT migration_name, checksum, applied_steps_count
    FROM "_prisma_migrations"
    ORDER BY finished_at
  `;

  let allMatch = true;

  for (const dbMigration of dbMigrations) {
    const migrationPath = join(migrationsDir, dbMigration.migration_name, 'migration.sql');

    try {
      const fileContent = readFileSync(migrationPath, 'utf-8');
      const fileChecksum = createHash('sha256').update(fileContent).digest('hex');

      const matches = fileChecksum === dbMigration.checksum;
      const status = matches ? '✅' : '❌';

      console.log(`${status} ${dbMigration.migration_name}`);
      if (!matches) {
        console.log(`   DB checksum:   ${dbMigration.checksum}`);
        console.log(`   File checksum: ${fileChecksum}`);
        allMatch = false;
      }
    } catch (error) {
      console.log(`❌ ${dbMigration.migration_name} - File not found`);
      allMatch = false;
    }
  }

  await prisma.$disconnect();

  console.log('\n' + (allMatch ? '✅ All checksums match!' : '❌ Checksum mismatches found!'));
  process.exit(allMatch ? 0 : 1);
}

verifyChecksums().catch(console.error);
