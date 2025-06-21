#!/usr/bin/env node

/**
 * Phase 2 Test Validation Script
 * Validates that all new DDD features have proper test coverage
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

console.log('\n📋 Phase 2: Test Validation\n');

// Features to validate
const featuresToValidate = [
  {
    name: 'Request Tracking Service',
    testFile: 'tests/unit/application/services/RequestTrackingService.test.js',
    patterns: ['track pending requests', 'track completed requests', 'prevent duplicates'],
  },
  {
    name: 'Avatar Preloading',
    testFile: 'tests/unit/application/commands/personality/AddCommand.test.js',
    patterns: ['preloadAvatar', 'avatar preload'],
  },
  {
    name: 'Alias Collision Handling',
    testFile: 'tests/unit/application/services/PersonalityApplicationService.test.js',
    patterns: ['collision', 'alternate alias', 'smart alias'],
  },
  {
    name: 'User ID Tracking',
    testFile: 'tests/unit/application/commands/conversation/ActivateCommand.test.js',
    patterns: ['userId', 'user ID', 'getUserId'],
  },
  {
    name: 'Message Tracking Integration',
    testFile: 'tests/unit/application/commands/CommandAdapter.test.js',
    patterns: ['messageTracker', 'duplicate message', 'track.*message'],
  },
  {
    name: 'Display Name Aliasing',
    testFile: 'tests/unit/application/services/PersonalityApplicationService.test.js',
    patterns: ['display name', 'displayName.*alias', 'automatic.*alias'],
  },
];

let allPassed = true;

// Validate each feature
featuresToValidate.forEach((feature) => {
  console.log(`\nChecking: ${feature.name}`);
  console.log(`Test file: ${feature.testFile}`);

  // Check if test file exists
  const testPath = path.join(__dirname, '..', feature.testFile);
  if (!fs.existsSync(testPath)) {
    console.log(`${RED}❌ Test file not found!${RESET}`);
    allPassed = false;
    return;
  }

  // Read test file content
  const content = fs.readFileSync(testPath, 'utf8');

  // Check for patterns
  const foundPatterns = [];
  const missingPatterns = [];

  feature.patterns.forEach((pattern) => {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(content)) {
      foundPatterns.push(pattern);
    } else {
      missingPatterns.push(pattern);
    }
  });

  if (missingPatterns.length === 0) {
    console.log(`${GREEN}✅ All test patterns found${RESET}`);
    foundPatterns.forEach((p) => console.log(`   ✓ ${p}`));
  } else {
    console.log(`${YELLOW}⚠️  Some patterns missing:${RESET}`);
    foundPatterns.forEach((p) => console.log(`   ${GREEN}✓ ${p}${RESET}`));
    missingPatterns.forEach((p) => console.log(`   ${RED}✗ ${p}${RESET}`));
    allPassed = false;
  }
});

// Run specific tests to validate they pass
console.log('\n\n📊 Running feature-specific tests...\n');

const testCommands = [
  {
    name: 'Request Tracking Service',
    command: 'npx jest tests/unit/application/services/RequestTrackingService.test.js --silent',
  },
  {
    name: 'Add Command (with new features)',
    command: 'npx jest tests/unit/application/commands/personality/AddCommand.test.js --silent',
  },
  {
    name: 'Personality Application Service',
    command:
      'npx jest tests/unit/application/services/PersonalityApplicationService.test.js --silent',
  },
  {
    name: 'Command Adapter (message tracking)',
    command: 'npx jest tests/unit/application/commands/CommandAdapter.test.js --silent',
  },
];

testCommands.forEach((test) => {
  try {
    console.log(`Running: ${test.name}`);
    execSync(test.command, { stdio: 'pipe' });
    console.log(`${GREEN}✅ Passed${RESET}`);
  } catch (error) {
    console.log(`${RED}❌ Failed${RESET}`);
    allPassed = false;
  }
});

// Summary
console.log('\n\n📈 Test Validation Summary\n');

if (allPassed) {
  console.log(`${GREEN}✅ All feature tests validated successfully!${RESET}`);
  console.log('\nPhase 2.1 (Unit Test Updates) is complete.');
  console.log('Ready to proceed with Phase 2.2 (Integration Testing).');
} else {
  console.log(`${RED}❌ Some tests need attention.${RESET}`);
  console.log('\nPlease fix the issues before proceeding.');
}

console.log('\n');