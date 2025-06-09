#!/usr/bin/env node

/**
 * Script to help migrate DDD tests to use consolidated mocks
 * This automates the common patterns to speed up migration
 */

const fs = require('fs');
const _path = require('path');

function migrateTestFile(testFilePath) {
  let content = fs.readFileSync(testFilePath, 'utf8');
  const changes = [];
  
  // Step 1: Add consolidated mock import if not present
  if (!content.includes("require('../../../__mocks__')") && 
      !content.includes('require("../../../__mocks__")')) {
    
    // Find the right number of ../ based on path depth
    const depth = testFilePath.split('/tests/unit/')[1].split('/').length - 1;
    const dots = '../'.repeat(depth);
    
    // Add after first comment block or at top
    const firstNonComment = content.search(/^(?!\/\*\*|\s*\*|\/\/)/m);
    const importStatement = `\nconst { presets } = require('${dots}__mocks__');\n`;
    
    content = content.slice(0, firstNonComment) + importStatement + content.slice(firstNonComment);
    changes.push('Added consolidated mock import');
  }
  
  // Step 2: Replace fs mock with consolidated version
  if (content.includes("jest.mock('fs'")) {
    const oldFsMock = /jest\.mock\(['"]fs['"],[\s\S]*?\}\)\);/;
    const hasFsMock = oldFsMock.test(content);
    
    if (hasFsMock) {
      // Comment out old mock
      content = content.replace(oldFsMock, (match) => {
        return `// Migrated to consolidated mocks\n// ${match.split('\n').join('\n// ')}`;
      });
      
      // Add note about using mockEnv.fs
      const beforeEachMatch = content.match(/beforeEach\s*\(\s*(?:async\s*)?\(\)\s*=>\s*\{/);
      if (beforeEachMatch) {
        const insertPos = beforeEachMatch.index + beforeEachMatch[0].length;
        content = content.slice(0, insertPos) + 
          '\n    // Use consolidated mock environment\n    mockEnv = presets.repositoryTest();\n    ' +
          content.slice(insertPos);
      }
      
      changes.push('Replaced fs mock with consolidated version');
    }
  }
  
  // Step 3: Update logger mocks
  if (content.includes("jest.mock('../../../../src/logger')") || 
      content.includes('jest.mock("../../../../src/logger")')) {
    content = content.replace(
      /jest\.mock\(['"]\.\.\/.*?\/logger['"]\);?/g,
      "// Logger mock included in consolidated mocks"
    );
    changes.push('Updated logger mock reference');
  }
  
  // Step 4: Add mockEnv declaration if using presets
  if (content.includes('presets.') && !content.includes('let mockEnv')) {
    // Find describe block
    const describeMatch = content.match(/describe\s*\([^)]+\)\s*\(\s*\)\s*=>\s*\{/);
    if (describeMatch) {
      const insertPos = describeMatch.index + describeMatch[0].length;
      content = content.slice(0, insertPos) + 
        '\n  let mockEnv;\n' + 
        content.slice(insertPos);
      changes.push('Added mockEnv declaration');
    }
  }
  
  // Step 5: Update timer setup for repositories/adapters
  if (testFilePath.includes('/adapters/') || testFilePath.includes('/repositories/')) {
    // Check if using timers
    if (content.includes('setInterval') || content.includes('setTimeout')) {
      // Add timer injection pattern
      const constructorMatch = content.match(/new\s+\w+Repository\s*\([^)]*\)/);
      if (constructorMatch && !constructorMatch[0].includes('setInterval:')) {
        const newConstructor = constructorMatch[0].replace(/\)$/, `,
      setInterval: mockEnv.timers.setInterval,
      clearInterval: mockEnv.timers.clearInterval
    )`);
        content = content.replace(constructorMatch[0], newConstructor);
        changes.push('Added timer injection to repository constructor');
      }
    }
  }
  
  // Step 6: Add proper test categorization comment
  if (!content.includes('* @jest-environment')) {
    const testType = testFilePath.includes('/domain/') ? 'domain' : 
                    testFilePath.includes('/adapters/') ? 'adapter' :
                    testFilePath.includes('/application/') ? 'application' : 'integration';
    
    content = `/**
 * @jest-environment node
 * @testType ${testType}
 */\n\n` + content;
    changes.push(`Added test type annotation: ${testType}`);
  }
  
  return { content, changes };
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node scripts/migrate-ddd-tests.js <test-file-path> [--dry-run]

Examples:
  node scripts/migrate-ddd-tests.js tests/unit/domain/personality/Personality.test.js
  node scripts/migrate-ddd-tests.js tests/unit/adapters/persistence/*.test.js --dry-run
`);
    process.exit(1);
  }
  
  const dryRun = args.includes('--dry-run');
  const files = args.filter(arg => !arg.startsWith('--'));
  
  console.log(`🔄 Migrating ${files.length} test file(s) to consolidated mocks...\n`);
  
  files.forEach(file => {
    if (!fs.existsSync(file)) {
      console.log(`❌ File not found: ${file}`);
      return;
    }
    
    console.log(`Processing: ${file}`);
    const { content, changes } = migrateTestFile(file);
    
    if (changes.length === 0) {
      console.log('  ✅ Already migrated or no changes needed\n');
      return;
    }
    
    console.log(`  Changes to apply:`);
    changes.forEach(change => console.log(`    - ${change}`));
    
    if (!dryRun) {
      // Create backup
      const backupPath = file + '.backup';
      fs.copyFileSync(file, backupPath);
      
      // Write updated content
      fs.writeFileSync(file, content);
      console.log(`  ✅ Migrated successfully (backup: ${backupPath})\n`);
    } else {
      console.log(`  🔍 Dry run - no changes made\n`);
    }
  });
  
  if (dryRun) {
    console.log('💡 Run without --dry-run to apply changes');
  }
}

if (require.main === module) {
  main();
}