#!/usr/bin/env node

/**
 * Script to fix hardcoded bot prefixes in DDD commands
 */

const fs = require('fs');
const path = require('path');

const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// Patterns to fix
const patterns = [
  {
    // Fix: '!tz' -> context.commandPrefix || '!tz'
    pattern: /(['"`])!tz(['"`])/g,
    replacement: (match, q1, q2) => `${q1}\${context.commandPrefix || '!tz'}${q2}`,
    description: 'Replace hardcoded !tz with dynamic prefix',
  },
  {
    // Fix: ${context.dependencies.botPrefix || '!tz'} -> ${context.commandPrefix || '!tz'}
    pattern: /\$\{context\.dependencies\.botPrefix \|\| '!tz'\}/g,
    replacement: '${context.commandPrefix || \'!tz\'}',
    description: 'Use context.commandPrefix instead of dependencies.botPrefix',
  },
  {
    // Fix standalone usage instructions
    pattern: /`!tz ([^`]+)`/g,
    replacement: (match, command) => {
      // Skip if it's already using template literal
      if (match.includes('${')) return match;
      return '`${context.commandPrefix || \'!tz\'} ' + command + '`';
    },
    description: 'Fix usage examples in backticks',
  },
];

// Files to check
const commandsDir = path.join(__dirname, '..', 'src', 'application', 'commands');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  let changes = [];

  patterns.forEach(({ pattern, replacement, description }) => {
    const matches = content.match(pattern);
    if (matches) {
      content = content.replace(pattern, replacement);
      modified = true;
      changes.push(`  - ${description}: ${matches.length} occurrence(s)`);
    }
  });

  if (modified) {
    // Special handling for files that need context in scope
    if (content.includes('${context.commandPrefix') && !content.includes('const prefix = context.commandPrefix')) {
      // Check if we're inside a function that has context
      const functionPattern = /function\s+\w+\s*\([^)]*context[^)]*\)|async\s+function[^(]*\([^)]*context[^)]*\)|=>\s*{[\s\S]*?context\.commandPrefix/;
      
      if (!functionPattern.test(content)) {
        console.log(`${YELLOW}Warning: ${filePath} uses context.commandPrefix but context might not be in scope${RESET}`);
      }
    }

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`${GREEN}Fixed: ${path.relative(process.cwd(), filePath)}${RESET}`);
    changes.forEach(change => console.log(change));
  }

  return modified;
}

function findCommandFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findCommandFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

console.log('Fixing hardcoded bot prefixes in DDD commands...\n');

const files = findCommandFiles(commandsDir);
let fixedCount = 0;

files.forEach(file => {
  if (processFile(file)) {
    fixedCount++;
  }
});

console.log(`\n${GREEN}Summary: Fixed ${fixedCount} file(s)${RESET}`);

if (fixedCount > 0) {
  console.log(`\n${YELLOW}Note: Some files might need manual review to ensure 'context' is available in scope.${RESET}`);
  console.log('Run tests to verify all changes work correctly.');
}