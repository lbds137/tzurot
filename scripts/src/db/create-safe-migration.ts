/**
 * Safe Migration Creator (db:migrate:safe)
 *
 * Wraps `prisma migrate dev --create-only` to:
 * 1. Generate the migration
 * 2. Automatically sanitize known drift patterns (from drift-ignore.json)
 * 3. Report what was removed/modified
 * 4. Provide clear next steps
 *
 * This prevents accidentally committing migrations that drop critical indexes
 * like the HNSW vector index or partial indexes that Prisma can't represent.
 *
 * @usage pnpm --filter @tzurot/scripts run db:migrate:safe -- <migration_name>
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DriftIgnoreConfig {
  protectedIndexes: Array<{
    name: string;
    table: string;
    type: string;
    description: string;
    recreateSQL: string;
    dropPattern: string;
    createPattern: string;
  }>;
  ignorePatterns: Array<{
    pattern: string;
    reason: string;
    action: 'remove' | 'comment';
  }>;
}

function loadDriftConfig(): DriftIgnoreConfig {
  const configPath = path.join(__dirname, '..', '..', '..', 'prisma', 'drift-ignore.json');
  if (!fs.existsSync(configPath)) {
    console.error('❌ drift-ignore.json not found at:', configPath);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function findLatestMigration(migrationsDir: string): string | null {
  const dirs = fs
    .readdirSync(migrationsDir)
    .filter(d => fs.statSync(path.join(migrationsDir, d)).isDirectory())
    .sort()
    .reverse();

  return dirs[0] ?? null;
}

function sanitizeMigration(
  migrationPath: string,
  config: DriftIgnoreConfig
): { removed: string[]; modified: boolean } {
  const content = fs.readFileSync(migrationPath, 'utf-8');
  const lines = content.split('\n');
  const removed: string[] = [];
  const newLines: string[] = [];

  for (const line of lines) {
    let shouldKeep = true;
    let matchedPattern: (typeof config.ignorePatterns)[0] | null = null;

    for (const pattern of config.ignorePatterns) {
      const regex = new RegExp(pattern.pattern, 'i');
      if (regex.test(line)) {
        matchedPattern = pattern;
        break;
      }
    }

    if (matchedPattern) {
      if (matchedPattern.action === 'remove') {
        shouldKeep = false;
        removed.push(`${line.trim()} (${matchedPattern.reason})`);
      } else if (matchedPattern.action === 'comment') {
        newLines.push(`-- DRIFT IGNORED: ${matchedPattern.reason}`);
        newLines.push(`-- ${line}`);
        shouldKeep = false;
        removed.push(`Commented: ${line.trim()}`);
      }
    }

    if (shouldKeep) {
      newLines.push(line);
    }
  }

  if (removed.length > 0) {
    fs.writeFileSync(migrationPath, newLines.join('\n'));
  }

  return { removed, modified: removed.length > 0 };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(a => a !== '--');
  const migrationName = args[0];

  console.log('🛡️  SAFE MIGRATION CREATOR');
  console.log('═'.repeat(60));

  if (!migrationName) {
    console.log('\nUsage: pnpm --filter @tzurot/scripts run db:migrate:safe -- <name>');
    console.log('\nExample:');
    console.log('  pnpm --filter @tzurot/scripts run db:migrate:safe -- add_user_settings');
    process.exit(1);
  }

  // Load drift config
  const config = loadDriftConfig();
  console.log(`\n📋 Loaded ${config.ignorePatterns.length} drift patterns to sanitize`);
  console.log(`   Protected indexes: ${config.protectedIndexes.map(p => p.name).join(', ')}`);

  // Run prisma migrate dev --create-only
  console.log('\n🔄 Running prisma migrate dev --create-only...\n');

  try {
    execSync(`npx prisma migrate dev --create-only --name ${migrationName}`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..', '..', '..'),
    });
  } catch (error) {
    console.error('\n❌ Prisma migration creation failed');
    console.log('\n💡 Common issues:');
    console.log('   - Database connection failed (check DATABASE_URL)');
    console.log('   - Schema has errors (run: npx prisma validate)');
    console.log('   - Shadow database required (use Railway dev DB)');
    process.exit(1);
  }

  // Find the newly created migration
  const migrationsDir = path.join(__dirname, '..', '..', '..', 'prisma', 'migrations');
  const latestMigration = findLatestMigration(migrationsDir);

  if (!latestMigration) {
    console.log('\n⚠️  No migration directory found. Migration may have been empty.');
    process.exit(0);
  }

  const migrationPath = path.join(migrationsDir, latestMigration, 'migration.sql');

  if (!fs.existsSync(migrationPath)) {
    console.log(`\n⚠️  Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  console.log(`\n📁 Migration created: ${latestMigration}`);

  // Sanitize the migration
  console.log('\n🧹 Sanitizing migration for known drift patterns...');
  const { removed, modified } = sanitizeMigration(migrationPath, config);

  if (modified) {
    console.log('\n⚠️  DRIFT PATTERNS REMOVED:');
    for (const r of removed) {
      console.log(`   - ${r}`);
    }
    console.log('\n✅ Migration sanitized successfully');
  } else {
    console.log('   No drift patterns found - migration is clean!');
  }

  // Show the migration content
  console.log('\n📄 MIGRATION CONTENT:');
  console.log('─'.repeat(60));
  const finalContent = fs.readFileSync(migrationPath, 'utf-8');
  console.log(finalContent);
  console.log('─'.repeat(60));

  // Next steps
  console.log('\n📋 NEXT STEPS:');
  console.log('1. Review the migration above');
  console.log('2. If correct, apply it:');
  console.log('   npx prisma migrate dev');
  console.log('3. If changes needed, edit:');
  console.log(`   ${migrationPath}`);
  console.log('4. To discard and start over:');
  console.log(`   rm -rf prisma/migrations/${latestMigration}`);
  console.log('');
}

main().catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});
