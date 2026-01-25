#!/usr/bin/env node

/**
 * Syntax validation for test files
 * Ensures files are valid JavaScript before and after migration
 */

const fs = require('fs');
const _path = require('path');
const { parse } = require('@babel/parser');

/**
 * Validate JavaScript syntax
 */
function validateSyntax(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // Try to parse with Babel
    parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: false,
    });

    // Also check for common test patterns
    const issues = [];

    // Check for balanced braces
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      issues.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
    }

    // Check for balanced parentheses
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      issues.push(`Unbalanced parentheses: ${openParens} open, ${closeParens} close`);
    }

    // Check for describe/it balance
    const describes = (content.match(/describe\s*\(/g) || []).length;
    const its = (content.match(/\bit\s*\(/g) || []).length;
    if (its > 0 && describes === 0) {
      issues.push('Has it() blocks but no describe()');
    }

    // Check for common syntax errors
    if (content.includes(';;')) {
      issues.push('Double semicolon detected');
    }

    if (/,\s*\}/.test(content)) {
      issues.push('Trailing comma before closing brace');
    }

    // Check for incomplete arrow functions
    if (/=>\s*$/.test(content)) {
      issues.push('Incomplete arrow function detected');
    }

    return {
      valid: issues.length === 0,
      issues,
      error: null,
    };
  } catch (error) {
    return {
      valid: false,
      issues: [],
      error: error.message,
    };
  }
}

/**
 * Run Jest on a single file to validate it actually works
 */
function validateWithJest(filePath) {
  const { execFileSync } = require('child_process');

  try {
    // Run jest with no coverage and silent output
    execFileSync('npx', ['jest', filePath, '--no-coverage', '--silent'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });

    return { valid: true, error: null };
  } catch (error) {
    // Jest exits with non-zero on test failure
    // Check if it's a syntax error or just failing tests
    const output = error.stdout || error.stderr || '';

    if (
      output.includes('SyntaxError') ||
      output.includes('Unexpected token') ||
      output.includes('Cannot find module')
    ) {
      return {
        valid: false,
        error: 'Jest syntax/import error: ' + output.substring(0, 200),
      };
    }

    // Test failures are OK, syntax errors are not
    return { valid: true, error: null };
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage: node scripts/validate-test-syntax.js <test-file> [--jest]

Options:
  --jest    Also run Jest to validate the test executes

Examples:
  node scripts/validate-test-syntax.js tests/unit/domain/personality/Personality.test.js
  node scripts/validate-test-syntax.js tests/unit/adapters/persistence/*.test.js --jest
`);
    process.exit(1);
  }

  const runJest = args.includes('--jest');
  const files = args.filter(arg => !arg.startsWith('--'));

  console.log(`🔍 Validating syntax for ${files.length} file(s)...\n`);

  let allValid = true;

  files.forEach(file => {
    console.log(`Checking: ${file}`);

    // Syntax validation
    const syntaxResult = validateSyntax(file);

    if (!syntaxResult.valid) {
      allValid = false;
      console.log(`  ❌ Syntax error!`);
      if (syntaxResult.error) {
        console.log(`     ${syntaxResult.error}`);
      }
      syntaxResult.issues.forEach(issue => {
        console.log(`     - ${issue}`);
      });
    } else {
      console.log(`  ✅ Syntax valid`);

      // Jest validation if requested
      if (runJest) {
        console.log(`  🧪 Running Jest validation...`);
        const jestResult = validateWithJest(file);

        if (!jestResult.valid) {
          allValid = false;
          console.log(`  ❌ Jest validation failed!`);
          console.log(`     ${jestResult.error}`);
        } else {
          console.log(`  ✅ Jest validation passed`);
        }
      }
    }

    console.log('');
  });

  if (allValid) {
    console.log('✅ All files have valid syntax!');
    process.exit(0);
  } else {
    console.log('❌ Some files have syntax errors!');
    process.exit(1);
  }
}

// Simple babel parser polyfill if not available
if (!require.resolve('@babel/parser')) {
  // Fallback to basic validation
  const { parse } = {
    parse: content => {
      new Function(content);
      return true;
    },
  };
  module.exports.parse = parse;
}

if (require.main === module) {
  main();
}
