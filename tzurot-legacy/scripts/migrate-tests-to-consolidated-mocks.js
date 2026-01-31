#!/usr/bin/env node

/**
 * Script to help identify tests that need migration to the consolidated mock system
 * This helps prevent timeout issues and ensures consistent testing patterns
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');

// Patterns that indicate manual mocking
const MANUAL_MOCK_PATTERNS = [
  /jest\.mock\(['"]\.\.\/.*config['"]\)/,
  /jest\.mock\(['"]\.\.\/.*logger['"]\)/,
  /jest\.mock\(['"]node-fetch['"]\)/,
  /mockFetch\s*=\s*jest\.fn/,
  /config\.\w+\s*=\s*jest\.fn/,
  /logger\.\w+\s*=\s*jest\.fn/,
  /new RateLimiter/,
  /setTimeout.*\d{4,}/,  // Timeouts > 1 second
  /setInterval.*\d{4,}/,
];

// Patterns that indicate proper consolidated mock usage
const CONSOLIDATED_MOCK_PATTERNS = [
  /require\(['"].*\/__mocks__['"]\)/,
  /presets\.(commandTest|webhookTest|integrationTest)/,
  /createTestEnvironment/,
  /jest\.useFakeTimers/,
];

// Known timeout-prone modules
const TIMEOUT_PRONE_MODULES = [
  'RateLimiter',
  'profileInfoFetcher',
  'aiService',
  'webhookManager',
];

async function analyzeTestFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const issues = [];
  const suggestions = [];

  // Check for manual mocking
  MANUAL_MOCK_PATTERNS.forEach(pattern => {
    if (pattern.test(content)) {
      const match = content.match(pattern);
      issues.push({
        type: 'manual_mock',
        pattern: pattern.toString(),
        match: match ? match[0] : 'pattern found'
      });
    }
  });

  // Check if using consolidated mocks
  const usesConsolidatedMocks = CONSOLIDATED_MOCK_PATTERNS.some(pattern => 
    pattern.test(content)
  );

  if (!usesConsolidatedMocks && issues.length > 0) {
    suggestions.push('Use consolidated mocks from tests/__mocks__/');
  }

  // Check for timeout-prone modules
  TIMEOUT_PRONE_MODULES.forEach(module => {
    if (content.includes(module) && !content.includes('jest.mock')) {
      issues.push({
        type: 'unmocked_module',
        module: module,
        suggestion: `Mock ${module} to prevent timeouts`
      });
    }
  });

  // Check for missing fake timers
  if (content.includes('setTimeout') || content.includes('setInterval')) {
    if (!content.includes('useFakeTimers')) {
      issues.push({
        type: 'missing_fake_timers',
        suggestion: 'Add jest.useFakeTimers() to handle timeouts'
      });
    }
  }

  // Check test timeout settings
  const timeoutMatch = content.match(/test\(['"].*['"]\s*,.*,\s*(\d+)\)/);
  if (timeoutMatch && parseInt(timeoutMatch[1]) > 5000) {
    issues.push({
      type: 'high_timeout',
      timeout: timeoutMatch[1],
      suggestion: 'Tests should complete in < 5 seconds. Check for unmocked operations.'
    });
  }

  return {
    file: filePath,
    issues,
    suggestions,
    usesConsolidatedMocks
  };
}

async function main() {
  console.log('Analyzing test files for migration needs...\n');

  const testFiles = glob.sync('tests/unit/**/*.test.js', {
    cwd: process.cwd()
  });

  const results = await Promise.all(
    testFiles.map(file => analyzeTestFile(file))
  );

  // Group results
  const needsMigration = results.filter(r => r.issues.length > 0);
  const properlyMocked = results.filter(r => 
    r.usesConsolidatedMocks && r.issues.length === 0
  );

  // Report results
  console.log(`Total test files analyzed: ${results.length}`);
  console.log(`Properly using consolidated mocks: ${properlyMocked.length}`);
  console.log(`Need migration: ${needsMigration.length}\n`);

  if (needsMigration.length > 0) {
    console.log('Tests needing migration:');
    console.log('========================\n');

    needsMigration.forEach(result => {
      console.log(`📁 ${result.file}`);
      result.issues.forEach(issue => {
        console.log(`  ⚠️  ${issue.type}: ${issue.suggestion || issue.match || issue.module}`);
      });
      if (result.suggestions.length > 0) {
        console.log(`  💡 Suggestions:`);
        result.suggestions.forEach(s => console.log(`     - ${s}`));
      }
      console.log();
    });

    // Generate migration template
    console.log('\nMigration Template:');
    console.log('==================');
    console.log(`
// Replace manual mocks with consolidated mocks
const { presets } = require('../../__mocks__');

// Mock rate limiter if needed
jest.mock('../../src/utils/rateLimiter', () => {
  const { createRateLimiterMock } = require('../../__mocks__/modules');
  return createRateLimiterMock();
});

describe('Your Test', () => {
  let mockEnv;
  
  beforeEach(() => {
    jest.useFakeTimers(); // If using timeouts
    mockEnv = presets.webhookTest(); // or commandTest()
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  test('your test', async () => {
    // Use mockEnv.api, mockEnv.discord, etc.
  });
});
`);
  }

  // List files with frequent timeout issues
  const timeoutProne = needsMigration.filter(r => 
    r.issues.some(i => 
      i.type === 'unmocked_module' || 
      i.type === 'missing_fake_timers' ||
      i.type === 'high_timeout'
    )
  );

  if (timeoutProne.length > 0) {
    console.log('\n⏱️  High Risk of Timeouts:');
    console.log('========================');
    timeoutProne.forEach(r => {
      console.log(`  - ${r.file}`);
    });
  }
}

main().catch(console.error);