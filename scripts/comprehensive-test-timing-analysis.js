#!/usr/bin/env node

/**
 * Comprehensive analysis of test timing issues
 * Looks for all potential causes of slow tests
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');

const SLOW_PATTERNS = {
  // Real implementations
  realRateLimiter: /new RateLimiter\(/g,
  realProfileFetcher: /require.*profileInfoFetcher(?!\.mock)/g,
  realAiService: /require.*aiService(?!\.mock)/g,
  realWebhookManager: /require.*webhookManager(?!\.mock)/g,
  
  // Async delays
  awaitDelay: /await\s+new\s+Promise.*\d{2,}/g,
  setTimeoutDelay: /setTimeout.*\d{3,}/g,
  
  // Missing mocks
  noMockSetup: (content) => {
    return !content.includes('jest.mock') && 
           !content.includes('__mocks__') &&
           (content.includes('require(') || content.includes('import '));
  },
  
  // Real network calls
  realFetch: /fetch\((?!.*mock)/g,
  realAxios: /axios\./g,
  
  // File I/O
  realFs: /fs\.(read|write|access)(?!.*mock)/g,
  
  // Long running loops
  longLoops: /for.*let i.*i\s*<\s*\d{3,}/g,
  
  // Missing consolidated mocks
  notUsingConsolidatedMocks: (content) => {
    return !content.includes('__mocks__') && content.includes('jest.mock');
  }
};

async function deepAnalyzeTest(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const issues = [];
  const estimatedDelay = 0;
  
  // Check each pattern
  Object.entries(SLOW_PATTERNS).forEach(([name, pattern]) => {
    if (typeof pattern === 'function') {
      if (pattern(content)) {
        issues.push({ type: name, severity: 'high' });
      }
    } else {
      const matches = content.match(pattern);
      if (matches) {
        issues.push({ 
          type: name, 
          count: matches.length,
          severity: name.includes('real') ? 'high' : 'medium'
        });
      }
    }
  });
  
  // Check imports
  const imports = content.match(/require\(['"]([^'"]+)['"]\)/g) || [];
  const srcImports = imports.filter(i => i.includes('../src/') || i.includes('../../src/'));
  
  if (srcImports.length > 0) {
    // Check if these imports are mocked
    const mockedImports = srcImports.filter(imp => {
      const module = imp.match(/require\(['"]([^'"]+)['"]\)/)[1];
      return content.includes(`jest.mock('${module}')`);
    });
    
    const unmockedCount = srcImports.length - mockedImports.length;
    if (unmockedCount > 0) {
      issues.push({
        type: 'unmockedImports',
        count: unmockedCount,
        severity: 'high'
      });
    }
  }
  
  return {
    file: filePath,
    issues,
    severity: issues.some(i => i.severity === 'high') ? 'high' : 
              issues.length > 0 ? 'medium' : 'low'
  };
}

async function main() {
  console.log('Performing comprehensive timing analysis...\n');
  
  const testFiles = glob.sync('tests/unit/**/*.test.js', {
    cwd: process.cwd()
  });
  
  const results = await Promise.all(
    testFiles.map(file => deepAnalyzeTest(file))
  );
  
  const highSeverity = results.filter(r => r.severity === 'high');
  const mediumSeverity = results.filter(r => r.severity === 'medium');
  
  console.log(`Total test files: ${results.length}`);
  console.log(`High severity issues: ${highSeverity.length}`);
  console.log(`Medium severity issues: ${mediumSeverity.length}\n`);
  
  // Group by issue type
  const issueTypes = {};
  results.forEach(result => {
    result.issues.forEach(issue => {
      if (!issueTypes[issue.type]) {
        issueTypes[issue.type] = [];
      }
      issueTypes[issue.type].push({
        file: result.file,
        count: issue.count || 1
      });
    });
  });
  
  console.log('Issue Type Summary:');
  console.log('==================\n');
  
  Object.entries(issueTypes)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([type, files]) => {
      console.log(`${type}: ${files.length} files`);
      if (files.length <= 5) {
        files.forEach(f => {
          console.log(`  - ${path.basename(f.file)}${f.count > 1 ? ` (${f.count} instances)` : ''}`);
        });
      }
    });
  
  // Show worst offenders
  console.log('\n🔴 Worst Offenders (High Severity):');
  console.log('===================================\n');
  
  highSeverity.slice(0, 10).forEach(result => {
    console.log(`${path.basename(result.file)}:`);
    result.issues.forEach(issue => {
      console.log(`  - ${issue.type}${issue.count ? ` (${issue.count}x)` : ''}`);
    });
  });
  
  // Recommendations
  console.log('\n📋 Recommendations:');
  console.log('==================\n');
  
  if (issueTypes.unmockedImports) {
    console.log('1. Add proper mocks for all src imports');
    console.log('   - Use consolidated mocks from tests/__mocks__/');
    console.log(`   - ${issueTypes.unmockedImports.length} files need this fix\n`);
  }
  
  if (issueTypes.notUsingConsolidatedMocks) {
    console.log('2. Migrate to consolidated mock system');
    console.log('   - Replace manual jest.mock() with preset mocks');
    console.log(`   - ${issueTypes.notUsingConsolidatedMocks.length} files need migration\n`);
  }
  
  if (issueTypes.realRateLimiter || issueTypes.setTimeoutDelay) {
    console.log('3. Use fake timers for all timing operations');
    console.log('   - Add jest.useFakeTimers() in beforeEach');
    console.log('   - Use jest.advanceTimersByTime() instead of real delays\n');
  }
  
  console.log('4. Global fix: Add to tests/setup.js:');
  console.log('   // Mock all timers by default');
  console.log('   beforeEach(() => jest.useFakeTimers());');
  console.log('   afterEach(() => jest.useRealTimers());');
}

main().catch(console.error);