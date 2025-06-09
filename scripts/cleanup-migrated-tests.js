#!/usr/bin/env node

/**
 * Cleanup script for migrated DDD tests
 * 
 * This script helps manage the migration process by:
 * 1. Replacing original files with migrated versions
 * 2. Cleaning up backup files
 * 3. Providing safety checks before operations
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

/**
 * Colors for console output
 */
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

/**
 * Find migration-related files in a directory
 */
function findMigrationFiles(directory) {
  const files = {
    migrated: [],
    backups: [],
    originals: []
  };
  
  if (!fs.existsSync(directory)) {
    return files;
  }
  
  const entries = fs.readdirSync(directory);
  
  entries.forEach(entry => {
    const fullPath = path.join(directory, entry);
    const stat = fs.statSync(fullPath);
    
    if (stat.isFile()) {
      if (entry.endsWith('.migrated.test.js')) {
        files.migrated.push(fullPath);
      } else if (entry.endsWith('.test.js.backup')) {
        files.backups.push(fullPath);
      } else if (entry.endsWith('.test.js') && !entry.includes('.migrated.') && !entry.includes('.backup')) {
        files.originals.push(fullPath);
      }
    }
  });
  
  return files;
}

/**
 * Validate that a migrated test passes
 */
function validateMigratedTest(testPath) {
  try {
    console.log(`  🧪 Running test: ${path.basename(testPath)}`);
    execSync(`npx jest "${testPath}" --no-coverage --silent`, {
      stdio: 'pipe',
      encoding: 'utf8'
    });
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error.stdout || error.stderr || 'Test failed'
    };
  }
}

/**
 * Process a single migrated test
 */
async function processMigratedTest(migratedPath, options = {}) {
  const baseName = path.basename(migratedPath).replace('.migrated.test.js', '.test.js');
  const directory = path.dirname(migratedPath);
  const originalPath = path.join(directory, baseName);
  const backupPath = originalPath + '.backup';
  
  console.log(`\n📄 Processing: ${baseName}`);
  
  // Check if migrated test exists
  if (!fs.existsSync(migratedPath)) {
    console.log(`  ${colors.red}❌ Migrated file not found${colors.reset}`);
    return false;
  }
  
  // Validate the migrated test
  if (!options.skipValidation) {
    const validation = validateMigratedTest(migratedPath);
    if (!validation.success) {
      console.log(`  ${colors.red}❌ Test validation failed:${colors.reset}`);
      console.log(`     ${validation.error}`);
      return false;
    }
    console.log(`  ${colors.green}✅ Test passes${colors.reset}`);
  }
  
  // Check for existing backup
  const hasBackup = fs.existsSync(backupPath);
  if (!hasBackup && fs.existsSync(originalPath)) {
    console.log(`  ${colors.yellow}⚠️  No backup found. Creating backup...${colors.reset}`);
    fs.copyFileSync(originalPath, backupPath);
  }
  
  // Replace original with migrated
  if (!options.dryRun) {
    fs.copyFileSync(migratedPath, originalPath);
    console.log(`  ${colors.green}✅ Replaced original with migrated version${colors.reset}`);
    
    // Remove migrated file
    fs.unlinkSync(migratedPath);
    console.log(`  ${colors.green}✅ Removed .migrated.test.js file${colors.reset}`);
    
    // Clean up backup if requested
    if (options.cleanBackups && hasBackup) {
      fs.unlinkSync(backupPath);
      console.log(`  ${colors.green}✅ Removed backup file${colors.reset}`);
    }
  } else {
    console.log(`  ${colors.blue}🔍 Dry run - no changes made${colors.reset}`);
  }
  
  return true;
}

/**
 * Main cleanup process
 */
async function main() {
  console.log('🧹 DDD Test Migration Cleanup Tool\n');
  
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    cleanBackups: args.includes('--clean-backups'),
    skipValidation: args.includes('--skip-validation')
  };
  
  // Remove option flags from args
  const directories = args.filter(arg => !arg.startsWith('--'));
  
  if (directories.length === 0) {
    console.log('Usage: node scripts/cleanup-migrated-tests.js <directory> [options]\n');
    console.log('Options:');
    console.log('  --dry-run          Show what would be done without making changes');
    console.log('  --clean-backups    Remove backup files after successful migration');
    console.log('  --skip-validation  Skip test validation (dangerous!)\n');
    console.log('Examples:');
    console.log('  node scripts/cleanup-migrated-tests.js tests/unit/domain/personality/');
    console.log('  node scripts/cleanup-migrated-tests.js tests/unit/domain/ --dry-run');
    console.log('  node scripts/cleanup-migrated-tests.js tests/unit/adapters/ --clean-backups\n');
    rl.close();
    return;
  }
  
  // Find all migration files
  const allFiles = {
    migrated: [],
    backups: [],
    originals: []
  };
  
  directories.forEach(dir => {
    const files = findMigrationFiles(dir);
    allFiles.migrated.push(...files.migrated);
    allFiles.backups.push(...files.backups);
    allFiles.originals.push(...files.originals);
  });
  
  console.log('📊 Found:');
  console.log(`   ${allFiles.migrated.length} migrated test files (.migrated.test.js)`);
  console.log(`   ${allFiles.backups.length} backup files (.test.js.backup)`);
  console.log(`   ${allFiles.originals.length} original test files\n`);
  
  if (allFiles.migrated.length === 0) {
    console.log('No migrated test files found. Nothing to clean up.\n');
    rl.close();
    return;
  }
  
  // Show what will be processed
  console.log('📋 Will process:');
  allFiles.migrated.forEach(file => {
    console.log(`   - ${path.relative(process.cwd(), file)}`);
  });
  console.log('');
  
  if (options.dryRun) {
    console.log(`${colors.blue}🔍 Running in DRY RUN mode - no changes will be made${colors.reset}\n`);
  }
  
  if (!options.skipValidation) {
    console.log('All migrated tests will be validated before replacement.\n');
  } else {
    console.log(`${colors.yellow}⚠️  WARNING: Skipping test validation!${colors.reset}\n`);
  }
  
  // Confirm before proceeding
  if (!options.dryRun) {
    const answer = await question('Proceed with cleanup? (y/n) ');
    if (answer.toLowerCase() !== 'y') {
      console.log('\nCleanup cancelled.');
      rl.close();
      return;
    }
  }
  
  // Process each migrated file
  let successCount = 0;
  let failCount = 0;
  
  for (const migratedPath of allFiles.migrated) {
    const success = await processMigratedTest(migratedPath, options);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }
  
  // Summary
  console.log('\n📊 Summary:');
  console.log(`   ${colors.green}✅ Successfully processed: ${successCount}${colors.reset}`);
  if (failCount > 0) {
    console.log(`   ${colors.red}❌ Failed: ${failCount}${colors.reset}`);
  }
  
  // Check for orphaned backups
  const orphanedBackups = allFiles.backups.filter(backup => {
    const originalName = backup.replace('.test.js.backup', '.test.js');
    return !fs.existsSync(originalName);
  });
  
  if (orphanedBackups.length > 0) {
    console.log(`\n${colors.yellow}⚠️  Found ${orphanedBackups.length} orphaned backup files:${colors.reset}`);
    orphanedBackups.forEach(backup => {
      console.log(`   - ${path.relative(process.cwd(), backup)}`);
    });
    
    if (!options.dryRun) {
      const cleanOrphans = await question('\nRemove orphaned backups? (y/n) ');
      if (cleanOrphans.toLowerCase() === 'y') {
        orphanedBackups.forEach(backup => {
          fs.unlinkSync(backup);
          console.log(`   ${colors.green}✅ Removed ${path.basename(backup)}${colors.reset}`);
        });
      }
    }
  }
  
  console.log('\n✅ Cleanup complete!');
  rl.close();
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    rl.close();
    process.exit(1);
  });
}