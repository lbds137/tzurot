#!/usr/bin/env node

/**
 * Generate a report on mock migration status
 * Shows progress and what needs to be done
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { promisify } = require('util');

const globAsync = promisify(glob);

async function analyzeTestFiles() {
  const testFiles = await globAsync('tests/unit/**/*.test.js');
  
  const stats = {
    total: testFiles.length,
    migrated: 0,
    partial: 0,
    legacy: 0,
    byPattern: {
      usesPresets: 0,
      usesMigrationHelper: 0,
      usesJestDoMock: 0,
      usesLegacyMocks: 0,
      usesHelpersCreateMock: 0,
      hasJestResetModules: 0
    },
    files: {
      migrated: [],
      partial: [],
      legacy: []
    }
  };
  
  for (const file of testFiles) {
    const content = await fs.readFile(file, 'utf8');
    const relPath = path.relative(process.cwd(), file);
    
    // Check patterns
    const hasPresets = /presets\.(commandTest|webhookTest|integrationTest)/.test(content);
    const hasMigrationHelper = /createMigrationHelper/.test(content);
    const hasJestDoMock = /jest\.doMock\(/.test(content);
    const hasLegacyMocks = /mockFactories|discordMocks|apiMocks/.test(content);
    const hasHelpersCreateMock = /helpers\.createMockMessage/.test(content);
    const hasJestResetModules = /jest\.resetModules\(\)/.test(content);
    
    // Update pattern stats
    if (hasPresets) stats.byPattern.usesPresets++;
    if (hasMigrationHelper) stats.byPattern.usesMigrationHelper++;
    if (hasJestDoMock) stats.byPattern.usesJestDoMock++;
    if (hasLegacyMocks) stats.byPattern.usesLegacyMocks++;
    if (hasHelpersCreateMock) stats.byPattern.usesHelpersCreateMock++;
    if (hasJestResetModules) stats.byPattern.hasJestResetModules++;
    
    // Categorize file
    if (hasPresets || hasMigrationHelper) {
      if (hasJestDoMock || hasLegacyMocks || hasHelpersCreateMock) {
        stats.partial++;
        stats.files.partial.push(relPath);
      } else {
        stats.migrated++;
        stats.files.migrated.push(relPath);
      }
    } else {
      stats.legacy++;
      stats.files.legacy.push(relPath);
    }
  }
  
  return stats;
}

async function generateReport() {
  console.log('📊 Mock Migration Status Report\n');
  console.log('Generated:', new Date().toISOString());
  console.log('=====================================\n');
  
  const stats = await analyzeTestFiles();
  
  // Overall Progress
  const migrationProgress = Math.round((stats.migrated / stats.total) * 100);
  console.log('📈 Overall Progress:');
  console.log(`   Total test files: ${stats.total}`);
  console.log(`   ✅ Fully migrated: ${stats.migrated} (${migrationProgress}%)`);
  console.log(`   🚧 Partially migrated: ${stats.partial}`);
  console.log(`   ❌ Legacy pattern: ${stats.legacy}`);
  console.log();
  
  // Progress bar
  const progressBar = '█'.repeat(migrationProgress / 5) + '░'.repeat(20 - migrationProgress / 5);
  console.log(`   Progress: [${progressBar}] ${migrationProgress}%`);
  console.log();
  
  // Pattern Usage
  console.log('🔍 Pattern Usage:');
  console.log(`   New consolidated mocks:`);
  console.log(`     - Using presets: ${stats.byPattern.usesPresets} files`);
  console.log(`     - Using migrationHelper: ${stats.byPattern.usesMigrationHelper} files`);
  console.log(`   Legacy patterns:`);
  console.log(`     - jest.doMock(): ${stats.byPattern.usesJestDoMock} files`);
  console.log(`     - Legacy mock imports: ${stats.byPattern.usesLegacyMocks} files`);
  console.log(`     - helpers.createMockMessage: ${stats.byPattern.usesHelpersCreateMock} files`);
  console.log(`   Problematic patterns:`);
  console.log(`     - jest.resetModules(): ${stats.byPattern.hasJestResetModules} files`);
  console.log();
  
  // Top files to migrate
  console.log('🎯 Priority Migration Targets:');
  console.log('   (Files using the most legacy patterns)');
  const priorityFiles = stats.files.legacy.slice(0, 10);
  priorityFiles.forEach(file => {
    console.log(`   - ${file}`);
  });
  if (stats.files.legacy.length > 10) {
    console.log(`   ... and ${stats.files.legacy.length - 10} more files`);
  }
  console.log();
  
  // Successfully migrated examples
  if (stats.files.migrated.length > 0) {
    console.log('✨ Successfully Migrated (examples to follow):');
    stats.files.migrated.slice(0, 5).forEach(file => {
      console.log(`   - ${file}`);
    });
    console.log();
  }
  
  // Recommendations
  console.log('💡 Recommendations:');
  if (stats.partial > 0) {
    console.log('   1. Fix partially migrated files first (easier wins)');
  }
  if (stats.byPattern.hasJestResetModules > 10) {
    console.log('   2. Run: node scripts/fix-jest-reset-modules.js');
  }
  if (stats.byPattern.usesHelpersCreateMock > 10) {
    console.log('   3. Run: node scripts/fix-helpers-not-defined.js');
  }
  if (stats.legacy > stats.migrated) {
    console.log('   4. Consider batch migration for similar test files');
  }
  console.log();
  
  // Next Steps
  console.log('📋 Next Steps:');
  console.log('   1. Enforce new patterns: npm run lint:test-mocks');
  console.log('   2. Fix violations in staged files before commit');
  console.log('   3. Gradually migrate remaining ' + stats.legacy + ' files');
  console.log('   4. Remove legacy mock files when migration complete');
  console.log();
  
  // Save detailed report
  const reportPath = path.join('docs', 'testing', 'MOCK_MIGRATION_STATUS.json');
  await fs.writeFile(reportPath, JSON.stringify(stats, null, 2));
  console.log(`📄 Detailed report saved to: ${reportPath}`);
}

generateReport().catch(console.error);