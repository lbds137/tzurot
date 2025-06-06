#!/usr/bin/env node

/**
 * Check for Hardcoded Bot Prefixes
 * 
 * This script searches for hardcoded bot prefixes (!tz, !rtz) that should
 * be using the dynamic botPrefix from config instead.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Patterns that indicate hardcoded prefixes
const hardcodedPatterns = [
  /['"`]!tz\s/g,      // "!tz ", '!tz ', `!tz `
  /['"`]!rtz\s/g,     // "!rtz ", '!rtz ', `!rtz `
  /Use !tz/g,         // Common in help text
  /Use !rtz/g,        // Common in help text
  /try !tz/gi,        // Common in error messages
  /try !rtz/gi,       // Common in error messages
  /\${['"`]!tz/g,     // Template literal with hardcoded prefix
  /\${['"`]!rtz/g,    // Template literal with hardcoded prefix
];

// Files/directories to exclude
const excludePatterns = [
  'node_modules',
  'coverage',
  '.git',
  'dist',
  'build',
  'config.js', // Config file is allowed to have the actual prefix
  'check-hardcoded-prefix.js', // This file
  'PREFIX_HANDLING_GUIDE.md', // Documentation about prefixes
];

/**
 * Check if a file path should be excluded
 */
function shouldExclude(filePath) {
  return excludePatterns.some(pattern => filePath.includes(pattern));
}

/**
 * Get all JavaScript files in a directory recursively
 */
function getJavaScriptFiles(dir) {
  const files = [];
  
  function traverse(currentPath) {
    if (shouldExclude(currentPath)) return;
    
    const stats = fs.statSync(currentPath);
    
    if (stats.isDirectory()) {
      try {
        const entries = fs.readdirSync(currentPath);
        entries.forEach(entry => {
          traverse(path.join(currentPath, entry));
        });
      } catch (error) {
        // Skip directories we can't read
      }
    } else if (stats.isFile() && currentPath.endsWith('.js')) {
      files.push(currentPath);
    }
  }
  
  traverse(dir);
  return files;
}

/**
 * Check a file for hardcoded prefixes
 */
function checkFile(filePath) {
  if (shouldExclude(filePath)) return [];
  
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];
  
  lines.forEach((line, index) => {
    hardcodedPatterns.forEach(pattern => {
      const matches = line.match(pattern);
      if (matches) {
        // Skip if it's importing botPrefix (allowed)
        if (line.includes('botPrefix') && line.includes('require')) return;
        // Skip if it's a comment about prefixes
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        
        issues.push({
          file: filePath,
          line: index + 1,
          content: line.trim(),
          match: matches[0]
        });
      }
    });
  });
  
  return issues;
}

/**
 * Get staged files if --staged flag is used
 */
function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return output
      .split('\n')
      .filter(file => file.endsWith('.js'))
      .map(file => path.resolve(file));
  } catch (error) {
    return [];
  }
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);
  const checkStaged = args.includes('--staged');
  
  console.log(`${colors.blue}🔍 Checking for hardcoded bot prefixes...${colors.reset}\n`);
  
  let files;
  
  if (checkStaged) {
    // Only check staged files
    files = getStagedFiles();
    if (files.length === 0) {
      console.log('No staged JavaScript files to check.');
      process.exit(0);
    }
    console.log(`Checking ${files.length} staged files...\n`);
  } else {
    // Check all files
    const srcDir = path.join(__dirname, '..', 'src');
    const testDir = path.join(__dirname, '..', 'tests');
    
    files = [
      ...getJavaScriptFiles(srcDir),
      ...getJavaScriptFiles(testDir)
    ];
    
    console.log(`Checking ${files.length} files...\n`);
  }
  
  // Check each file
  const allIssues = [];
  files.forEach(file => {
    const issues = checkFile(file);
    allIssues.push(...issues);
  });
  
  // Report results
  if (allIssues.length === 0) {
    console.log(`${colors.green}✅ No hardcoded prefixes found!${colors.reset}`);
    console.log('\nAll bot prefixes are properly using the dynamic botPrefix from config.');
    process.exit(0);
  } else {
    console.log(`${colors.red}❌ Found ${allIssues.length} hardcoded prefix${allIssues.length > 1 ? 'es' : ''}:${colors.reset}\n`);
    
    // Group by file
    const byFile = {};
    allIssues.forEach(issue => {
      if (!byFile[issue.file]) byFile[issue.file] = [];
      byFile[issue.file].push(issue);
    });
    
    // Display issues
    Object.entries(byFile).forEach(([file, issues]) => {
      const relativePath = path.relative(process.cwd(), file);
      console.log(`${colors.yellow}${relativePath}${colors.reset}`);
      
      issues.forEach(issue => {
        console.log(`  ${colors.red}Line ${issue.line}:${colors.reset} ${issue.content}`);
        console.log(`  ${' '.repeat(9)}${colors.yellow}Found: "${issue.match}"${colors.reset}`);
      });
      
      console.log();
    });
    
    console.log(`${colors.blue}How to fix:${colors.reset}`);
    console.log('1. Import botPrefix: const { botPrefix } = require("../config");');
    console.log('2. Use template literals: `Use ${botPrefix} help`');
    console.log('3. For classes, accept botPrefix in constructor options');
    console.log('\nSee docs/development/PREFIX_HANDLING_GUIDE.md for more details.');
    
    process.exit(1);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/check-hardcoded-prefix.js [options]');
  console.log('\nOptions:');
  console.log('  --staged    Only check staged files (for pre-commit hook)');
  console.log('  --help, -h  Show this help message');
  console.log('\nChecks for hardcoded bot prefixes (!tz, !rtz) in JavaScript files.');
  console.log('These should use the dynamic botPrefix from config instead.');
  process.exit(0);
}

// Run the check
main();