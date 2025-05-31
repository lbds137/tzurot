#!/usr/bin/env node

/**
 * Script to check for timer patterns that might be difficult to test
 * 
 * Usage: node scripts/check-timer-patterns.js
 */

const fs = require('fs');
const glob = require('glob');

// Helper to check if code is inside a default parameter or arrow function
function isInsideDefaultParam(content, matchIndex) {
  // Look for patterns like: = (ms) => new Promise(resolve => setTimeout
  // or: || ((ms) => new Promise(resolve => setTimeout
  const before = content.substring(Math.max(0, matchIndex - 100), matchIndex);
  return /(?:=|\|\|)\s*\(?\([^)]*\)\s*=>\s*(?:new\s+)?Promise\s*\(\s*(?:resolve|res)\s*=>\s*$/.test(before);
}

// Helper to check if code is defining an injectable function
function isInjectableDefinition(content, matchIndex) {
  // Check if this is part of a scheduler/delay/timer function definition
  const before = content.substring(Math.max(0, matchIndex - 50), matchIndex);
  return /(?:scheduler|delay|timer|interval)(?:Fn)?\s*(?:=|\|\|)\s*/.test(before);
}

// Patterns to look for
const TIMER_PATTERNS = [
  {
    name: 'Promise with setTimeout',
    pattern: /await\s+new\s+Promise\s*\(\s*(?:resolve|res)\s*=>\s*setTimeout/g,
    message: 'Found Promise-wrapped setTimeout. Consider using injectable delay function.',
    severity: 'error',
    filter: (content, match, index) => !isInsideDefaultParam(content, index)
  },
  {
    name: 'Direct setTimeout usage',
    pattern: /(?<!this\.)(?<!options\.)(?<!context\.)(?<!timerFunctions\.)(?<!schedulerFn|delayFn|timer|scheduler|delay)\s*setTimeout\s*\(/g,
    message: 'Direct setTimeout usage. Use injectable timer instead.',
    severity: 'error',
    filter: (content, match, index) => {
      // Skip if it's inside a default parameter
      if (isInsideDefaultParam(content, index)) return false;
      // Skip if it's part of an injectable definition
      if (isInjectableDefinition(content, index)) return false;
      // Skip if it's in a comment
      const lineStart = content.lastIndexOf('\n', index) + 1;
      const lineEnd = content.indexOf('\n', index);
      const line = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd);
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return false;
      return true;
    }
  },
  {
    name: 'Direct setInterval usage',
    pattern: /(?<!this\.)(?<!options\.)(?<!context\.)(?<!timerFunctions\.)(?<!intervalFn|timer|scheduler|interval)\s*setInterval\s*\(/g,
    message: 'Direct setInterval usage. Use injectable timer instead.',
    severity: 'error',
    filter: (content, match, index) => {
      // Skip if it's part of an injectable definition
      if (isInjectableDefinition(content, index)) return false;
      // Skip if it's in a comment
      const lineStart = content.lastIndexOf('\n', index) + 1;
      const lineEnd = content.indexOf('\n', index);
      const line = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd);
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return false;
      return true;
    }
  },
  {
    name: 'setInterval without cleanup tracking',
    pattern: /(?:this\.|options\.|context\.)?(?:interval|scheduler)\s*\([^)]+\)(?!\.unref)/g,
    message: 'setInterval without unref(). Consider adding unref() for cleanup.',
    severity: 'warning',
    filter: (content, match, _index) => {
      // Only check if it looks like setInterval usage
      return match.includes('interval');
    }
  },
  {
    name: 'Global timer in module scope',
    pattern: /^(?!.*(?:function|const|let|var|class|return|timerFunctions\.)).*(?:setTimeout|setInterval)\s*\(/gm,
    message: 'Timer at module scope. Consider making it injectable.',
    severity: 'warning',
    filter: (content, match, _index) => {
      // Skip if it's in a comment
      if (match.trim().startsWith('//') || match.trim().startsWith('*')) return false;
      // Skip if it's already using injectable pattern
      if (match.includes('timerFunctions.')) return false;
      return true;
    }
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

  TIMER_PATTERNS.forEach(({ name, pattern, message, severity, filter }) => {
    let match;
    pattern.lastIndex = 0; // Reset regex state
    
    while ((match = pattern.exec(content)) !== null) {
      // Apply filter if provided
      if (filter && !filter(content, match[0], match.index)) {
        continue;
      }
      
      // Find line number
      const lines = content.substring(0, match.index).split('\n');
      const lineNumber = lines.length;
      
      // Get the line containing the match for context
      const lineStart = content.lastIndexOf('\n', match.index) + 1;
      const lineEnd = content.indexOf('\n', match.index + match[0].length);
      const codeLine = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd).trim();
      
      issues.push({
        pattern: name,
        message,
        severity,
        line: lineNumber,
        code: codeLine.substring(0, 80) + (codeLine.length > 80 ? '...' : '')
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