#!/usr/bin/env node

/**
 * Script to check for timer patterns that might be difficult to test
 * 
 * Usage: node scripts/check-timer-patterns.js
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Patterns to look for
const TIMER_PATTERNS = [
  {
    name: 'Promise with setTimeout',
    pattern: /await\s+new\s+Promise\s*\(\s*(?:resolve|res)\s*=>\s*setTimeout/g,
    message: 'Found Promise-wrapped setTimeout. Consider using injectable delay function.',
    severity: 'error'
  },
  {
    name: 'Direct setTimeout in async function',
    pattern: /async[\s\S]*?setTimeout\s*\((?!.*options\.scheduler)(?!.*context\.)(?!.*this\.scheduler)/g,
    message: 'setTimeout in async function. Consider making it injectable.',
    severity: 'error'
  },
  {
    name: 'setInterval without cleanup tracking',
    pattern: /setInterval\s*\([^)]+\)(?!\.unref)/g,
    message: 'setInterval without unref(). Consider storing interval ID for cleanup.',
    severity: 'warning'
  },
  {
    name: 'Direct setTimeout in class method',
    pattern: /class[\s\S]*?setTimeout\s*\(/g,
    message: 'setTimeout in class. Use injectable timer from constructor options.',
    severity: 'error'
  },
  {
    name: 'Global timer in module scope',
    pattern: /^(?!.*function)(?!.*=).*(?:setTimeout|setInterval)\s*\(/gm,
    message: 'Timer at module scope. Consider making it injectable.',
    severity: 'warning'
  },
  {
    name: 'Timer in constructor without injection',
    pattern: /constructor\s*\([^)]*\)[\s\S]*?(?<!options\.)(?<!this\.)(?:setTimeout|setInterval)\s*\([^=]/g,
    message: 'Timer in constructor. Accept timer functions via options.',
    severity: 'error'
  }
];

// Directories to check
const SOURCE_DIRS = ['src'];

// Files to exclude
const EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/*.test.js',
  '**/*.spec.js',
  '**/tests/**'
];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const issues = [];

  TIMER_PATTERNS.forEach(({ name, pattern, message, severity }) => {
    const matches = content.match(pattern);
    if (matches) {
      // Find line numbers for each match
      matches.forEach(match => {
        const lines = content.substring(0, content.indexOf(match)).split('\n');
        const lineNumber = lines.length;
        issues.push({
          pattern: name,
          message,
          severity,
          line: lineNumber,
          code: match.trim()
        });
      });
    }
  });

  return issues;
}

function main() {
  const args = process.argv.slice(2);
  const checkStagedOnly = args.includes('--staged');
  
  console.log('🔍 Checking for timer patterns that might be difficult to test...\n');

  let totalIssues = 0;
  let errorCount = 0;
  let warningCount = 0;
  const fileIssues = {};

  let files = [];
  
  if (checkStagedOnly) {
    // Get staged files from git
    const { execSync } = require('child_process');
    try {
      const stagedFiles = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
        .split('\n')
        .filter(file => file.endsWith('.js') && file.startsWith('src/'))
        .filter(file => !EXCLUDE_PATTERNS.some(pattern => {
          const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
          return regex.test(file);
        }));
      files = stagedFiles;
      console.log(`Checking ${files.length} staged files...\n`);
    } catch (error) {
      console.error('Error getting staged files:', error.message);
      process.exit(1);
    }
  } else {
    SOURCE_DIRS.forEach(dir => {
      const dirFiles = glob.sync(`${dir}/**/*.js`, {
        ignore: EXCLUDE_PATTERNS
      });
      files.push(...dirFiles);
    });
  }

  files.forEach(file => {
    const issues = checkFile(file);
    if (issues.length > 0) {
      fileIssues[file] = issues;
      totalIssues += issues.length;
      issues.forEach(issue => {
        if (issue.severity === 'error') errorCount++;
        else if (issue.severity === 'warning') warningCount++;
      });
    }
  });

  if (totalIssues === 0) {
    console.log('✅ No problematic timer patterns found!');
    console.log('\n🎉 All timer code follows testable patterns. Great job!');
    return;
  }

  console.log(`Found ${totalIssues} timer pattern issues:\n`);
  console.log(`  ❌ ${errorCount} errors (must fix)`);
  console.log(`  ⚠️  ${warningCount} warnings (should fix)\n`);

  Object.entries(fileIssues).forEach(([file, issues]) => {
    console.log(`📄 ${file}`);
    issues.forEach(issue => {
      const icon = issue.severity === 'error' ? '❌' : '⚠️ ';
      console.log(`  ${icon} Line ${issue.line}: ${issue.pattern}`);
      console.log(`     ${issue.message}`);
      console.log(`     Code: ${issue.code}`);
    });
    console.log('');
  });

  console.log('\n📚 See docs/core/TIMER_PATTERNS.md for guidance on making timer code testable.');
  console.log('💡 See docs/development/TIMER_ENFORCEMENT_GUIDE.md for enforcement processes.');
  console.log('🔧 Run "npm run lint:timers" to check timer patterns before committing.\n');

  // Exit with non-zero code if errors found (for CI)
  // Warnings alone don't fail the build
  process.exit(errorCount > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}