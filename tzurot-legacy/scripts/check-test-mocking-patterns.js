#!/usr/bin/env node

/**
 * Script to check that tests are not mocking the code they're testing
 * This is a critical issue - if you mock what you're testing, you're not testing anything!
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Patterns to detect improper mocking
const MOCK_PATTERNS = [
  /jest\.mock\(['"`](.+?)['"`]/g,
  /jest\.doMock\(['"`](.+?)['"`]/g,
];

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function checkTestFile(testFilePath) {
  const issues = [];
  
  // Determine what module this test is testing
  const testFileRelative = path.relative(process.cwd(), testFilePath);
  const moduleBeingTested = testFileRelative
    .replace('/tests/unit/', '/src/')
    .replace('.test.js', '.js')
    .replace('.migrated.test.js', '.js'); // Handle migrated tests
  
  // Also check without .js extension (for directory imports)
  const moduleBeingTestedNoExt = moduleBeingTested.replace('.js', '');
  
  // Read test file
  const content = fs.readFileSync(testFilePath, 'utf8');
  
  // Find all mock calls
  MOCK_PATTERNS.forEach(pattern => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const mockedModule = match[1];
      
      // Check if the mocked module is the module being tested
      if (mockedModule.endsWith(moduleBeingTested) || 
          mockedModule.endsWith(moduleBeingTestedNoExt) ||
          mockedModule.includes(moduleBeingTestedNoExt + '/')) {
        
        // Find line number
        const lines = content.substring(0, match.index).split('\n');
        const lineNumber = lines.length;
        
        issues.push({
          line: lineNumber,
          mockedModule,
          moduleBeingTested,
          severity: 'error'
        });
      }
      
      // Also check for mocking parent modules of what we're testing
      if (moduleBeingTested.includes(mockedModule) && 
          !mockedModule.includes('node_modules') &&
          !mockedModule.startsWith('.')) {
        const lines = content.substring(0, match.index).split('\n');
        const lineNumber = lines.length;
        
        issues.push({
          line: lineNumber,
          mockedModule,
          moduleBeingTested,
          severity: 'warning',
          message: 'Mocking parent module of system under test'
        });
      }
    }
    pattern.lastIndex = 0; // Reset regex
  });
  
  // Check for specific DDD anti-patterns
  if (testFilePath.includes('/domain/')) {
    // Domain tests should have minimal mocking
    const mockCount = (content.match(/jest\.(do)?[Mm]ock/g) || []).length;
    if (mockCount > 2) { // Allow logger and maybe one other
      issues.push({
        line: 0,
        severity: 'warning',
        message: `Domain test has ${mockCount} mocks - consider if all are necessary`
      });
    }
  }
  
  if (testFilePath.includes('/adapters/')) {
    // Adapter tests should not mock domain modules
    const domainMocks = content.match(/jest\.(do)?[Mm]ock\(['"`][^'"]*\/domain\//g) || [];
    domainMocks.forEach(domainMock => {
      const lines = content.substring(0, content.indexOf(domainMock)).split('\n');
      issues.push({
        line: lines.length,
        severity: 'error',
        message: 'Adapter tests should not mock domain modules',
        mockedModule: domainMock
      });
    });
  }
  
  return issues;
}

function main() {
  const args = process.argv.slice(2);
  const checkSpecificFiles = args.length > 0 && !args[0].startsWith('--');
  
  console.log('🔍 Checking test mocking patterns...\n');
  
  let files = [];
  
  if (checkSpecificFiles) {
    // Check specific files
    files = args.filter(arg => arg.endsWith('.js'));
  } else {
    // Check all test files
    files = glob.sync('tests/unit/**/*.test.js');
  }
  
  let totalIssues = 0;
  let errorCount = 0;
  let warningCount = 0;
  const fileIssues = {};
  
  files.forEach(file => {
    const issues = checkTestFile(file);
    if (issues.length > 0) {
      fileIssues[file] = issues;
      totalIssues += issues.length;
      issues.forEach(issue => {
        if (issue.severity === 'error') errorCount++;
        else warningCount++;
      });
    }
  });
  
  if (totalIssues === 0) {
    console.log(`${colors.green}✅ All tests have proper mocking boundaries!${colors.reset}`);
    return;
  }
  
  // Report issues
  console.log(`Found ${totalIssues} mocking issues:\n`);
  console.log(`  ${colors.red}❌ ${errorCount} errors${colors.reset} (mocking system under test)`);
  console.log(`  ${colors.yellow}⚠️  ${warningCount} warnings${colors.reset} (questionable mocking)\n`);
  
  Object.entries(fileIssues).forEach(([file, issues]) => {
    console.log(`${colors.yellow}📄 ${file}${colors.reset}`);
    issues.forEach(issue => {
      const icon = issue.severity === 'error' ? '❌' : '⚠️ ';
      const color = issue.severity === 'error' ? colors.red : colors.yellow;
      
      if (issue.line) {
        console.log(`  ${color}${icon} Line ${issue.line}: ${issue.message || 'Mocking module under test'}${colors.reset}`);
        if (issue.mockedModule) {
          console.log(`     Mocked: ${issue.mockedModule}`);
          console.log(`     Testing: ${issue.moduleBeingTested}`);
        }
      } else {
        console.log(`  ${color}${icon} ${issue.message}${colors.reset}`);
      }
    });
    console.log('');
  });
  
  console.log(`\n${colors.yellow}💡 Remember:${colors.reset}`);
  console.log('  - Never mock the module you are testing');
  console.log('  - Domain tests should mock minimal external dependencies');
  console.log('  - Adapter tests should not mock domain modules');
  console.log('  - Use dependency injection instead of mocking internals\n');
  
  // Exit with error if errors found
  process.exit(errorCount > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}