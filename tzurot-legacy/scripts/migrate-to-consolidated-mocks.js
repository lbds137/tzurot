#!/usr/bin/env node

/**
 * Migration script to convert test files to use consolidated mocks
 * This will remove manual mocking code and rely on global mocks instead
 */

const fs = require('fs').promises;
const path = require('path');

// Patterns to identify manual mocks that can be removed
const MOCK_PATTERNS = [
  // Rate limiter mocks
  /jest\.mock\(['"]\.\.\/.*?rateLimiter['"],.*?\}\);?/gs,
  /jest\.mock\(['"].*?\/utils\/rateLimiter['"],.*?\}\);?/gs,
  
  // Profile info fetcher mocks
  /jest\.mock\(['"]\.\.\/.*?profileInfoFetcher['"],.*?\}\);?/gs,
  /jest\.mock\(['"].*?\/profileInfoFetcher['"],.*?\}\);?/gs,
  
  // Webhook manager mocks
  /jest\.mock\(['"]\.\.\/.*?webhookManager['"],.*?\}\);?/gs,
  /jest\.mock\(['"].*?\/webhookManager['"],.*?\}\);?/gs,
  
  // AI service mocks
  /jest\.mock\(['"]\.\.\/.*?aiService['"],.*?\}\);?/gs,
  /jest\.mock\(['"].*?\/aiService['"],.*?\}\);?/gs,
  
  // Conversation manager mocks
  /jest\.mock\(['"]\.\.\/.*?conversationManager['"],.*?\}\);?/gs,
  /jest\.mock\(['"].*?\/conversationManager['"],.*?\}\);?/gs,
  
  // Personality manager mocks
  /jest\.mock\(['"]\.\.\/.*?personalityManager['"],.*?\}\);?/gs,
  /jest\.mock\(['"].*?\/personalityManager['"],.*?\}\);?/gs,
  
  // Data storage mocks
  /jest\.mock\(['"]\.\.\/.*?dataStorage['"],.*?\}\);?/gs,
  /jest\.mock\(['"].*?\/dataStorage['"],.*?\}\);?/gs,
  
  // Logger mocks
  /jest\.mock\(['"]\.\.\/.*?logger['"],.*?\}\);?/gs,
  /jest\.mock\(['"].*?\/logger['"],.*?\}\);?/gs,
  
  // Config mocks
  /jest\.mock\(['"]\.\.\/.*?config\.js['"],.*?\}\);?/gs,
  /jest\.mock\(['"].*?\/config\.js['"],.*?\}\);?/gs,
  
  // Node-fetch mocks
  /jest\.mock\(['"]node-fetch['"],.*?\}\);?/gs,
  
  // File system mocks
  /jest\.mock\(['"]fs['"],.*?\}\);?/gs,
  /jest\.mock\(['"]fs\/promises['"],.*?\}\);?/gs,
];

// Pattern to detect if test is already using consolidated mocks
const USING_CONSOLIDATED_MOCKS = /require\(['"].*?\/mocks\/[^'"]+\.mock\.js['"]\)/;

async function getAllTestFiles() {
  const testDir = path.join(__dirname, '..', 'tests', 'unit');
  const files = [];
  
  async function scanDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.endsWith('.test.js')) {
        files.push(fullPath);
      }
    }
  }
  
  await scanDir(testDir);
  return files;
}

async function migrateFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  let modified = content;
  let changesMade = false;
  
  // Skip if already using consolidated mocks
  if (USING_CONSOLIDATED_MOCKS.test(content)) {
    console.log(`⏭️  ${path.relative(process.cwd(), filePath)} - Already using consolidated mocks`);
    return false;
  }
  
  // Check if file has any manual mocks we can remove
  const hasManualMocks = MOCK_PATTERNS.some(pattern => pattern.test(content));
  
  if (!hasManualMocks) {
    console.log(`⏭️  ${path.relative(process.cwd(), filePath)} - No manual mocks to migrate`);
    return false;
  }
  
  // Remove manual mock implementations
  for (const pattern of MOCK_PATTERNS) {
    const before = modified;
    modified = modified.replace(pattern, '');
    if (before !== modified) {
      changesMade = true;
    }
  }
  
  // Clean up extra empty lines that might have been left
  modified = modified.replace(/\n\n\n+/g, '\n\n');
  
  // Remove leading newlines at the start of the file
  modified = modified.trimStart();
  
  if (changesMade) {
    await fs.writeFile(filePath, modified);
    console.log(`✅ ${path.relative(process.cwd(), filePath)} - Migrated to global mocks`);
    return true;
  }
  
  return false;
}

async function main() {
  console.log('🔄 Starting migration to consolidated mocks...\n');
  
  const testFiles = await getAllTestFiles();
  console.log(`Found ${testFiles.length} test files to check.\n`);
  
  let migratedCount = 0;
  let errorCount = 0;
  
  for (const file of testFiles) {
    try {
      const migrated = await migrateFile(file);
      if (migrated) {
        migratedCount++;
      }
    } catch (error) {
      console.error(`❌ Error migrating ${path.relative(process.cwd(), file)}: ${error.message}`);
      errorCount++;
    }
  }
  
  console.log('\n📊 Migration Summary:');
  console.log(`   Total files checked: ${testFiles.length}`);
  console.log(`   Files migrated: ${migratedCount}`);
  console.log(`   Files skipped: ${testFiles.length - migratedCount - errorCount}`);
  console.log(`   Errors: ${errorCount}`);
  
  if (migratedCount > 0) {
    console.log('\n✨ Migration complete! Run tests to verify everything still works.');
    console.log('   npm test');
  } else {
    console.log('\n✨ No files needed migration.');
  }
}

// Run the migration
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});