#!/usr/bin/env node

/**
 * Verify Mock Methods Script
 * 
 * This script verifies that all mocked methods in test files
 * actually exist in the real implementations.
 * 
 * Usage: node scripts/verify-mock-methods.js [test-files...]
 */

const fs = require('fs');
const path = require('path');

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

/**
 * Extract mocked methods from a test file
 */
function extractMockedMethods(testFile) {
  const content = fs.readFileSync(testFile, 'utf8');
  const methods = [];
  
  // Pattern to match mock method calls
  // Matches: mockSomething.methodName.mockResolvedValue/mockReturnValue/etc
  const patterns = [
    /mock([A-Z]\w+)\.(\w+)\.(mock\w+)/g,
    /(\w+)\.(\w+) = jest\.fn\(/g,
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const mockName = match[1];
      const methodName = match[2];
      
      // Skip common test utilities
      if (['jest', 'expect', 'describe', 'it', 'beforeEach', 'afterEach'].includes(mockName)) {
        continue;
      }
      
      methods.push({
        mockName,
        methodName,
        file: testFile,
        line: content.substring(0, match.index).split('\n').length
      });
    }
  });
  
  return methods;
}

/**
 * Try to determine the source file for a mock
 */
function findSourceFile(testFile, mockName) {
  const testContent = fs.readFileSync(testFile, 'utf8');
  
  // Look for require statements that might indicate the source
  const requirePattern = new RegExp(`require\\(['"]([^'"]+)['"]\\).*${mockName}`, 'i');
  const match = testContent.match(requirePattern);
  
  if (match) {
    const requirePath = match[1];
    if (requirePath.startsWith('.')) {
      // Relative path
      const testDir = path.dirname(testFile);
      return path.resolve(testDir, requirePath + '.js');
    }
  }
  
  // Try to map common mock names to source files
  const mockToSource = {
    'githubClient': 'src/core/notifications/GitHubReleaseClient.js',
    'versionTracker': 'src/core/notifications/VersionTracker.js',
    'preferences': 'src/core/notifications/UserPreferencesPersistence.js',
    // 'authManager': removed - using DDD authentication
    'client': 'discord.js', // External dependency
  };
  
  const baseDir = path.join(__dirname, '..');
  const sourcePath = mockToSource[mockName.toLowerCase()];
  
  if (sourcePath && !sourcePath.includes('node_modules')) {
    return path.join(baseDir, sourcePath);
  }
  
  return null;
}

/**
 * Verify if a method exists in the source file
 */
function verifyMethodExists(sourceFile, methodName) {
  if (!sourceFile || !fs.existsSync(sourceFile)) {
    return { exists: false, reason: 'Source file not found' };
  }
  
  const content = fs.readFileSync(sourceFile, 'utf8');
  
  // Look for method definitions
  const patterns = [
    // Class methods: methodName() { or methodName = () => {
    new RegExp(`\\b${methodName}\\s*\\([^)]*\\)\\s*{`, 'm'),
    new RegExp(`\\b${methodName}\\s*=\\s*(async\\s*)?\\([^)]*\\)\\s*=>`, 'm'),
    new RegExp(`\\b${methodName}\\s*=\\s*(async\\s*)?function`, 'm'),
    // Object methods: methodName: function
    new RegExp(`\\b${methodName}\\s*:\\s*(async\\s*)?function`, 'm'),
    new RegExp(`\\b${methodName}\\s*:\\s*(async\\s*)?\\([^)]*\\)\\s*=>`, 'm'),
  ];
  
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      return { exists: true };
    }
  }
  
  return { exists: false, reason: 'Method not found in source' };
}

/**
 * Main verification function
 */
function verifyMocks(testFiles) {
  let totalMocks = 0;
  let verifiedMocks = 0;
  let unverifiedMocks = 0;
  let externalMocks = 0;
  const issues = [];
  
  testFiles.forEach(testFile => {
    if (!fs.existsSync(testFile)) {
      console.error(`${colors.red}File not found: ${testFile}${colors.reset}`);
      return;
    }
    
    console.log(`\n${colors.blue}Checking ${testFile}...${colors.reset}`);
    
    const mockedMethods = extractMockedMethods(testFile);
    
    mockedMethods.forEach(({ mockName, methodName, line }) => {
      totalMocks++;
      
      // Skip external dependencies
      if (['client', 'message', 'channel', 'guild', 'user'].includes(mockName.toLowerCase())) {
        externalMocks++;
        return;
      }
      
      const sourceFile = findSourceFile(testFile, mockName);
      
      if (!sourceFile) {
        console.log(`  ${colors.yellow}⚠ Cannot determine source for mock '${mockName}'${colors.reset}`);
        unverifiedMocks++;
        return;
      }
      
      const verification = verifyMethodExists(sourceFile, methodName);
      
      if (verification.exists) {
        verifiedMocks++;
        console.log(`  ${colors.green}✓ ${mockName}.${methodName}${colors.reset}`);
      } else {
        unverifiedMocks++;
        issues.push({
          file: testFile,
          line,
          mockName,
          methodName,
          reason: verification.reason
        });
        console.log(`  ${colors.red}✗ ${mockName}.${methodName} - ${verification.reason}${colors.reset}`);
        console.log(`    at line ${line}`);
      }
    });
  });
  
  // Summary
  console.log(`\n${colors.blue}=== Summary ===${colors.reset}`);
  console.log(`Total mocks checked: ${totalMocks}`);
  console.log(`${colors.green}Verified: ${verifiedMocks}${colors.reset}`);
  console.log(`${colors.yellow}External/Skipped: ${externalMocks}${colors.reset}`);
  console.log(`${colors.red}Unverified: ${unverifiedMocks}${colors.reset}`);
  
  if (issues.length > 0) {
    console.log(`\n${colors.red}=== Issues Found ===${colors.reset}`);
    issues.forEach(issue => {
      console.log(`${issue.file}:${issue.line} - ${issue.mockName}.${issue.methodName}`);
    });
    
    console.log(`\n${colors.red}❌ Mock verification failed!${colors.reset}`);
    console.log('Some mocked methods do not exist in the real implementations.');
    console.log('This could lead to tests passing but code failing in production.');
    process.exit(1);
  } else {
    console.log(`\n${colors.green}✅ All mocks verified successfully!${colors.reset}`);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  // No specific files provided, check all test files
  const { execSync } = require('child_process');
  const testFiles = execSync('find tests -name "*.test.js" -type f', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  
  console.log(`Found ${testFiles.length} test files to check...`);
  verifyMocks(testFiles);
} else {
  verifyMocks(args);
}