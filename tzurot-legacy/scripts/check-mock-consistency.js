#!/usr/bin/env node

/**
 * Script to check mock consistency across test files
 * Identifies which tests use old vs new mock patterns
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { promisify } = require('util');

const globAsync = promisify(glob);

// Patterns that indicate old vs new mock usage
const OLD_PATTERNS = [
  /helpers\.createMockMessage/,
  /require.*commandTestHelpers/,
  /require.*mockFactories/,
  /require.*discordMocks/,
  /require.*apiMocks/,
  /jest\.doMock\(/,
  /jest\.mock\([^)]+,\s*\(\)\s*=>\s*\{/  // jest.mock with inline implementation
];

const NEW_PATTERNS = [
  /require.*__mocks__/,
  /presets\.commandTest/,
  /presets\.webhookTest/,
  /mockEnv\.discord/,
  /mockEnv\.api/,
  /mockEnv\.modules/,
  /createMigrationHelper/
];

async function analyzeFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    
    const oldMatches = OLD_PATTERNS.filter(pattern => pattern.test(content));
    const newMatches = NEW_PATTERNS.filter(pattern => pattern.test(content));
    
    let status = 'unknown';
    if (oldMatches.length > 0 && newMatches.length === 0) {
      status = 'old';
    } else if (newMatches.length > 0 && oldMatches.length === 0) {
      status = 'new';
    } else if (oldMatches.length > 0 && newMatches.length > 0) {
      status = 'mixed';
    }
    
    return {
      file: filePath,
      status,
      oldPatterns: oldMatches.length,
      newPatterns: newMatches.length,
      details: {
        old: oldMatches.map(p => p.toString()),
        new: newMatches.map(p => p.toString())
      }
    };
  } catch (error) {
    return { file: filePath, error: error.message };
  }
}

async function main() {
  console.log('🔍 Checking mock consistency across test files...\n');
  
  // Find all test files
  const testFiles = await globAsync('tests/unit/**/*.test.js');
  
  console.log(`Found ${testFiles.length} test files\n`);
  
  // Analyze all files
  const results = await Promise.all(testFiles.map(analyzeFile));
  
  // Group by status
  const oldTests = results.filter(r => r.status === 'old');
  const newTests = results.filter(r => r.status === 'new');
  const mixedTests = results.filter(r => r.status === 'mixed');
  const unknownTests = results.filter(r => r.status === 'unknown');
  const errors = results.filter(r => r.error);
  
  // Report results
  console.log('📊 Summary:');
  console.log(`   - Old pattern: ${oldTests.length} files`);
  console.log(`   - New pattern: ${newTests.length} files`);
  console.log(`   - Mixed pattern: ${mixedTests.length} files`);
  console.log(`   - Unknown: ${unknownTests.length} files`);
  console.log(`   - Errors: ${errors.length} files`);
  console.log();
  
  if (oldTests.length > 0) {
    console.log('🔧 Files using OLD mock pattern (need migration):');
    oldTests.slice(0, 10).forEach(r => {
      console.log(`   - ${r.file}`);
    });
    if (oldTests.length > 10) {
      console.log(`   ... and ${oldTests.length - 10} more files`);
    }
    console.log();
  }
  
  if (mixedTests.length > 0) {
    console.log('⚠️  Files using MIXED patterns (partially migrated):');
    mixedTests.forEach(r => {
      console.log(`   - ${r.file}`);
      console.log(`     Old: ${r.details.old.join(', ')}`);
      console.log(`     New: ${r.details.new.join(', ')}`);
    });
    console.log();
  }
  
  if (newTests.length > 0) {
    console.log('✅ Files using NEW mock pattern:');
    newTests.slice(0, 5).forEach(r => {
      console.log(`   - ${r.file}`);
    });
    if (newTests.length > 5) {
      console.log(`   ... and ${newTests.length - 5} more files`);
    }
    console.log();
  }
  
  // Migration recommendation
  if (oldTests.length > 0 || mixedTests.length > 0) {
    console.log('💡 Recommendation:');
    console.log('   Run the migration script to update tests to the new mock system:');
    console.log('   node scripts/migrate-to-consolidated-mocks.js');
    console.log();
  }
  
  // Check for legacy mock files that can be removed
  const legacyFiles = [
    'tests/mocks/discord.js.mock.js',
    'tests/mocks/profileInfoFetcher.mocks.js',
    'tests/utils/apiMocks.js',
    'tests/utils/discordMocks.js',
    'tests/utils/mockFactories.js'
  ];
  
  console.log('🗑️  Checking for legacy mock files...');
  for (const file of legacyFiles) {
    try {
      await fs.access(file);
      console.log(`   ❌ ${file} - can be removed after migration`);
    } catch {
      console.log(`   ✅ ${file} - already removed`);
    }
  }
}

main().catch(console.error);