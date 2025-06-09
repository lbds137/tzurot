#!/usr/bin/env node

/**
 * Guided DDD Test Migration Helper
 * 
 * This script helps guide manual migration of DDD tests to consolidated mocks.
 * It does NOT automatically modify files - it provides guidance and templates.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

/**
 * Analyze test file to determine type and dependencies
 */
function analyzeTestFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  
  const analysis = {
    fileName,
    filePath,
    testType: 'unknown',
    hasMocks: false,
    mockedModules: [],
    externalDependencies: [],
    isDomainTest: false,
    isAdapterTest: false,
    isServiceTest: false,
    hasTimers: false,
    hasFileSystem: false,
    hasLogger: false
  };
  
  // Determine test type based on path and content
  if (filePath.includes('/domain/') && filePath.includes('Id.test.js')) {
    analysis.testType = 'value-object';
    analysis.isDomainTest = true;
  } else if (filePath.includes('/domain/') && !filePath.includes('/adapters/')) {
    analysis.testType = 'domain';
    analysis.isDomainTest = true;
  } else if (filePath.includes('/adapters/')) {
    analysis.testType = 'adapter';
    analysis.isAdapterTest = true;
  } else if (content.includes('Service') && filePath.includes('/domain/')) {
    analysis.testType = 'service';
    analysis.isServiceTest = true;
  }
  
  // Check for mocks
  const mockMatches = content.matchAll(/jest\.mock\(['"]([^'"]+)['"]/g);
  for (const match of mockMatches) {
    analysis.hasMocks = true;
    analysis.mockedModules.push(match[1]);
  }
  
  // Check for specific dependencies
  if (content.includes('require(\'fs\')') || content.includes('from \'fs\'')) {
    analysis.hasFileSystem = true;
    analysis.externalDependencies.push('fs');
  }
  
  if (content.includes('logger') || analysis.mockedModules.includes('../../../../src/logger')) {
    analysis.hasLogger = true;
    analysis.externalDependencies.push('logger');
  }
  
  if (content.includes('setTimeout') || content.includes('setInterval')) {
    analysis.hasTimers = true;
    analysis.externalDependencies.push('timers');
  }
  
  return analysis;
}

/**
 * Generate migration template based on analysis
 */
function generateMigrationTemplate(analysis) {
  let template = `/**
 * @jest-environment node
 * @testType ${analysis.testType}
 * 
 * ${analysis.fileName.replace('.test.js', '')} Test
`;

  // Add description based on type
  if (analysis.testType === 'value-object') {
    template += ` * - Pure domain test with no external dependencies
 * - Tests business rules and validation logic
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { ${analysis.fileName.replace('.test.js', '')} } = require('../../../../src/domain/...');

describe('${analysis.fileName.replace('.test.js', '')}', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No console mocking needed for pure domain tests
  });
`;
  } else if (analysis.testType === 'adapter') {
    template += ` * - Tests [adapter description]
 * - Mocks external dependencies (${analysis.externalDependencies.join(', ')})
 * - Domain models are NOT mocked (real integration)
 */

const { dddPresets } = require('../../../__mocks__/ddd');
`;

    // Add mocks
    if (analysis.hasFileSystem) {
      template += `
// Mock external dependencies FIRST (before any imports)
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn()
  }
}));
`;
    }

    if (analysis.hasLogger) {
      template += `
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));
`;
    }

    template += `
// Now import mocked modules
${analysis.hasFileSystem ? "const fs = require('fs').promises;" : ''}

// Adapter under test - NOT mocked!
const { ${analysis.fileName.replace('.test.js', '')} } = require('../../../../src/adapters/...');

// Domain models - NOT mocked! We want real domain logic
const { /* Import domain models */ } = require('../../../../src/domain/...');

describe('${analysis.fileName.replace('.test.js', '')}', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    ${analysis.hasTimers ? 'jest.useFakeTimers();' : ''}
    
    // Set up mock behavior
    ${analysis.hasFileSystem ? 'fs.mkdir.mockResolvedValue();' : ''}
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
    ${analysis.hasTimers ? 'jest.useRealTimers();' : ''}
  });
`;
  }
  
  template += `
  // ... existing test cases
});`;
  
  return template;
}

/**
 * Show migration checklist
 */
function showMigrationChecklist(analysis) {
  console.log('\n📋 Migration Checklist:\n');
  console.log('1. [ ] Create backup of test file');
  console.log('2. [ ] Add test header comment with @testType');
  console.log('3. [ ] Import consolidated mocks (dddPresets or presets)');
  console.log('4. [ ] Move jest.mock() calls BEFORE imports');
  console.log('5. [ ] Add comments clarifying what is/isn\'t mocked');
  console.log('6. [ ] Update beforeEach/afterEach for consistency');
  
  if (analysis.hasTimers) {
    console.log('7. [ ] Add jest.useFakeTimers() in beforeEach');
    console.log('8. [ ] Add jest.useRealTimers() in afterEach');
  }
  
  console.log(`${analysis.hasTimers ? '9' : '7'}. [ ] Run syntax validation`);
  console.log(`${analysis.hasTimers ? '10' : '8'}. [ ] Run test to ensure it passes`);
  console.log(`${analysis.hasTimers ? '11' : '9'}. [ ] Compare test output before/after`);
}

/**
 * Main migration guide
 */
async function main() {
  console.log('🔧 DDD Test Migration Guide\n');
  console.log('This tool helps guide manual migration of DDD tests.');
  console.log('It analyzes test files and provides templates but does NOT modify files.\n');
  
  const testFile = process.argv[2];
  
  if (!testFile) {
    console.log('Usage: node scripts/guide-ddd-test-migration.js <test-file>\n');
    console.log('Example: node scripts/guide-ddd-test-migration.js tests/unit/domain/personality/Personality.test.js\n');
    
    // Show list of DDD test files
    console.log('Available DDD test files:');
    const domainTests = require('child_process')
      .execSync('find tests/unit/domain -name "*.test.js" | sort', { encoding: 'utf8' })
      .trim()
      .split('\n');
    const adapterTests = require('child_process')
      .execSync('find tests/unit/adapters -name "*.test.js" | sort', { encoding: 'utf8' })
      .trim()
      .split('\n');
    
    console.log('\nDomain tests:');
    domainTests.forEach(test => console.log(`  ${test}`));
    console.log('\nAdapter tests:');
    adapterTests.forEach(test => console.log(`  ${test}`));
    
    rl.close();
    return;
  }
  
  if (!fs.existsSync(testFile)) {
    console.error(`❌ Error: File not found: ${testFile}`);
    rl.close();
    return;
  }
  
  console.log(`📄 Analyzing: ${testFile}\n`);
  
  const analysis = analyzeTestFile(testFile);
  
  // Show analysis results
  console.log('📊 Analysis Results:');
  console.log(`   Test Type: ${analysis.testType}`);
  console.log(`   Has Mocks: ${analysis.hasMocks ? 'Yes' : 'No'}`);
  if (analysis.mockedModules.length > 0) {
    console.log(`   Mocked Modules:`);
    analysis.mockedModules.forEach(mod => console.log(`     - ${mod}`));
  }
  if (analysis.externalDependencies.length > 0) {
    console.log(`   External Dependencies:`);
    analysis.externalDependencies.forEach(dep => console.log(`     - ${dep}`));
  }
  console.log('');
  
  // Generate template
  console.log('📝 Migration Template:\n');
  console.log('```javascript');
  console.log(generateMigrationTemplate(analysis));
  console.log('```\n');
  
  // Show checklist
  showMigrationChecklist(analysis);
  
  // Provide commands
  console.log('\n🛠️  Useful Commands:\n');
  console.log(`# Create backup:`);
  console.log(`cp "${testFile}" "${testFile}.backup"\n`);
  
  console.log(`# Validate syntax after migration:`);
  console.log(`node scripts/validate-test-syntax.js "${testFile}"\n`);
  
  console.log(`# Run test:`);
  console.log(`npx jest "${testFile}" --no-coverage\n`);
  
  console.log(`# Compare with original:`);
  console.log(`diff -u "${testFile}.backup" "${testFile}"\n`);
  
  // Ask if they want to see example migrations
  const showExamples = await question('\nWould you like to see example migrations? (y/n) ');
  
  if (showExamples.toLowerCase() === 'y') {
    console.log('\n📚 Example Migrations:\n');
    console.log('1. Simple Value Object: tests/unit/domain/personality/PersonalityId.migrated.test.js');
    console.log('2. Complex Repository: tests/unit/adapters/persistence/FilePersonalityRepository.migrated.test.js');
    console.log('3. Discord Adapter: tests/unit/adapters/discord/DiscordWebhookAdapter.migrated.test.js\n');
    console.log('View these files to see complete migration examples.');
  }
  
  console.log('\n✅ Migration guide complete! Remember to migrate manually and carefully.');
  console.log('📖 See docs/testing/DDD_TEST_MIGRATION_GUIDE.md for detailed patterns.\n');
  
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