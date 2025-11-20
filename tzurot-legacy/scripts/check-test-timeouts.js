#!/usr/bin/env node

/**
 * Pre-commit hook to check for common timeout anti-patterns in test files
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Patterns that indicate potential long-running tests
const TIMEOUT_ANTI_PATTERNS = [
  {
    pattern: /setTimeout\s*\([^,]+,\s*(\d+)\)/g,
    check: (match, timeout) => parseInt(timeout) > 5000,
    message: 'Found setTimeout with duration > 5 seconds. Use fake timers instead.'
  },
  {
    pattern: /new\s+Promise\s*\(\s*resolve\s*=>\s*setTimeout/g,
    check: () => true,
    message: 'Found Promise with setTimeout. Use fake timers for time-based tests.'
  },
  {
    pattern: /\.rejects\.toThrow\(\)\s*\}\s*,\s*(\d+)\s*\)/g,
    check: (match, timeout) => parseInt(timeout) > 10000,
    message: 'Test timeout is too long. Consider using fake timers.'
  },
  {
    pattern: /await\s+new\s+Promise\s*\(\s*resolve\s*=>\s*setTimeout/g,
    check: () => true,
    message: 'Waiting for real time in tests. Use jest.useFakeTimers() instead.'
  },
  {
    pattern: /jest\.setTimeout\s*\(\s*(\d+)\s*\)/g,
    check: (match, timeout) => parseInt(timeout) > 10000,
    message: 'Test timeout is too long. Keep test timeouts under 10 seconds.'
  },
  {
    pattern: /\.registerPendingMessage\s*\(/g,
    check: (match, _, content) => {
      // Only flag if fake timers are NOT being used
      return !content.includes('useFakeTimers') && !content.includes('setupFakeTimers');
    },
    message: 'registerPendingMessage creates real timeouts. Ensure jest.useFakeTimers() is called.'
  },
  {
    pattern: /\.scheduleCleanup\s*\(/g,
    check: (match, _, content) => {
      return !content.includes('useFakeTimers') && !content.includes('setupFakeTimers');
    },
    message: 'scheduleCleanup creates real timeouts. Ensure jest.useFakeTimers() is called.'
  },
  {
    pattern: /requestTracker\.schedule/g,
    check: (match, _, content) => {
      return !content.includes('useFakeTimers') && !content.includes('setupFakeTimers');
    },
    message: 'Request tracker scheduling creates real timeouts. Ensure jest.useFakeTimers() is called.'
  }
];

// Check if file should use fake timers
const SHOULD_USE_FAKE_TIMERS = [
  /timeout/i,
  /delay/i,
  /wait/i,
  /slow/i,
  /abort/i,
  /download.*time/i
];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  
  // Skip if fake timers are already being used
  const usesFakeTimers = content.includes('useFakeTimers') || 
                        content.includes('setupFakeTimers');
  
  // Check for anti-patterns
  for (const antiPattern of TIMEOUT_ANTI_PATTERNS) {
    let match;
    while ((match = antiPattern.pattern.exec(content)) !== null) {
      if (antiPattern.check(match[0], match[1], content)) {
        const line = content.substring(0, match.index).split('\n').length;
        issues.push({
          file: filePath,
          line,
          message: antiPattern.message,
          snippet: match[0]
        });
      }
    }
  }
  
  // Check if file should use fake timers but doesn't
  if (!usesFakeTimers) {
    const shouldUseFakeTimers = SHOULD_USE_FAKE_TIMERS.some(pattern => 
      pattern.test(content)
    );
    
    if (shouldUseFakeTimers && content.includes('setTimeout')) {
      issues.push({
        file: filePath,
        line: 0,
        message: 'This test file appears to test timeout behavior but does not use fake timers.',
        snippet: 'Add jest.useFakeTimers() in beforeEach()'
      });
    }
  }
  
  return issues;
}

function getTestFiles() {
  try {
    // Get staged test files
    const stagedFiles = execSync('git diff --cached --name-only --diff-filter=ACM')
      .toString()
      .split('\n')
      .filter(file => file.endsWith('.test.js') || file.endsWith('.spec.js'));
    
    return stagedFiles;
  } catch (error) {
    // If not in a git repo, check all test files
    const testDir = path.join(__dirname, '..', 'tests');
    const files = [];
    
    function walkDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith('.test.js')) {
          files.push(fullPath);
        }
      }
    }
    
    if (fs.existsSync(testDir)) {
      walkDir(testDir);
    }
    
    return files;
  }
}

function main() {
  console.log('Checking for timeout anti-patterns in test files...\n');
  
  const testFiles = getTestFiles();
  let totalIssues = 0;
  
  for (const file of testFiles) {
    if (!file || !fs.existsSync(file)) continue;
    
    const issues = checkFile(file);
    if (issues.length > 0) {
      console.log(`\n❌ ${file}:`);
      for (const issue of issues) {
        console.log(`  Line ${issue.line}: ${issue.message}`);
        console.log(`  Found: ${issue.snippet}`);
      }
      totalIssues += issues.length;
    }
  }
  
  if (totalIssues > 0) {
    console.log(`\n❌ Found ${totalIssues} timeout anti-patterns.`);
    console.log('\n📖 See docs/testing/PREVENTING_LONG_RUNNING_TESTS.md for best practices.\n');
    process.exit(1);
  } else {
    console.log('✅ No timeout anti-patterns found!\n');
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { checkFile, TIMEOUT_ANTI_PATTERNS };