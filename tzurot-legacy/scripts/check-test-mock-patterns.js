#!/usr/bin/env node

/**
 * Enforcement script for test mock patterns
 * This runs as part of quality checks and pre-commit hooks
 */

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { promisify } = require('util');

const globAsync = promisify(glob);

const MOCK_PATTERN_RULES = {
  // Deprecated patterns that should not be used
  deprecated: [
    {
      pattern: /jest\.doMock\(/g,
      message: 'jest.doMock() is deprecated',
      suggestion: 'Use createMigrationHelper() and standard jest.mock()'
    },
    {
      pattern: /require\(['"].*mockFactories['"]\)/g,
      message: 'mockFactories is deprecated',
      suggestion: 'Use tests/__mocks__/ consolidated mocks'
    },
    {
      pattern: /require\(['"].*discordMocks['"]\)/g,
      message: 'discordMocks is deprecated',
      suggestion: 'Use tests/__mocks__/discord.js'
    },
    {
      pattern: /require\(['"].*apiMocks['"]\)/g,
      message: 'apiMocks is deprecated',
      suggestion: 'Use tests/__mocks__/api.js'
    }
  ],
  
  // Patterns that indicate mixing old and new approaches
  conflicts: [
    {
      oldPattern: /helpers\.createMockMessage/g,
      newPattern: /createMigrationHelper/g,
      message: 'Mixing old helpers with new migration helper'
    },
    {
      oldPattern: /jest\.doMock/g,
      newPattern: /presets\.(commandTest|webhookTest)/g,
      message: 'Mixing jest.doMock with new preset system'
    }
  ],
  
  // Required patterns for new tests
  required: {
    ifUsing: /describe\(['"].*Command/,
    mustHave: [
      {
        pattern: /createMigrationHelper|presets\.(commandTest|webhookTest)/,
        message: 'Command tests must use createMigrationHelper() or presets'
      }
    ]
  }
};

async function checkFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const issues = [];
    
    // Check for deprecated patterns
    for (const rule of MOCK_PATTERN_RULES.deprecated) {
      const matches = content.match(rule.pattern);
      if (matches) {
        issues.push({
          type: 'deprecated',
          message: rule.message,
          suggestion: rule.suggestion,
          count: matches.length
        });
      }
    }
    
    // Check for conflicting patterns
    for (const conflict of MOCK_PATTERN_RULES.conflicts) {
      const hasOld = conflict.oldPattern.test(content);
      const hasNew = conflict.newPattern.test(content);
      
      if (hasOld && hasNew) {
        issues.push({
          type: 'conflict',
          message: conflict.message
        });
      }
    }
    
    // Check required patterns for new tests
    if (MOCK_PATTERN_RULES.required.ifUsing.test(content)) {
      for (const requirement of MOCK_PATTERN_RULES.required.mustHave) {
        if (!requirement.pattern.test(content)) {
          issues.push({
            type: 'missing',
            message: requirement.message
          });
        }
      }
    }
    
    // Check for jest.resetModules() which can break imports
    if (/jest\.resetModules\(\)/.test(content)) {
      issues.push({
        type: 'warning',
        message: 'jest.resetModules() can break helper imports',
        suggestion: 'Remove jest.resetModules() or ensure helpers are re-imported after'
      });
    }
    
    return { file: filePath, issues };
  } catch (error) {
    return { file: filePath, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isStrict = args.includes('--strict');
  const files = args.filter(arg => !arg.startsWith('--'));
  
  console.log('🔍 Checking test mock patterns...\n');
  
  // Get files to check
  let testFiles;
  if (files.length > 0) {
    // Check specific files
    testFiles = files.filter(f => f.endsWith('.test.js'));
  } else {
    // Check all test files
    testFiles = await globAsync('tests/unit/**/*.test.js');
  }
  
  if (testFiles.length === 0) {
    console.log('No test files to check.');
    return 0;
  }
  
  console.log(`Checking ${testFiles.length} test file(s)...\n`);
  
  // Check all files
  const results = await Promise.all(testFiles.map(checkFile));
  
  // Categorize results
  const filesWithIssues = results.filter(r => r.issues && r.issues.length > 0);
  const errors = results.filter(r => r.error);
  
  // Report issues
  let hasErrors = false;
  
  if (filesWithIssues.length > 0) {
    console.log('⚠️  Mock pattern issues found:\n');
    
    for (const result of filesWithIssues) {
      console.log(`📄 ${result.file}`);
      
      for (const issue of result.issues) {
        const icon = issue.type === 'deprecated' ? '🚫' :
                    issue.type === 'conflict' ? '⚔️' :
                    issue.type === 'missing' ? '❌' : '⚠️';
        
        console.log(`   ${icon} ${issue.message}`);
        if (issue.suggestion) {
          console.log(`      💡 ${issue.suggestion}`);
        }
        if (issue.count) {
          console.log(`      Found ${issue.count} occurrence(s)`);
        }
        
        // In strict mode, any issue is an error
        if (isStrict) {
          hasErrors = true;
        } else if (issue.type === 'deprecated' || issue.type === 'conflict') {
          hasErrors = true;
        }
      }
      console.log();
    }
  }
  
  if (errors.length > 0) {
    console.log('❌ File read errors:\n');
    errors.forEach(r => {
      console.log(`   - ${r.file}: ${r.error}`);
    });
    hasErrors = true;
  }
  
  // Summary
  console.log('📊 Summary:');
  console.log(`   - Files checked: ${testFiles.length}`);
  console.log(`   - Files with issues: ${filesWithIssues.length}`);
  console.log(`   - Errors: ${errors.length}`);
  
  if (filesWithIssues.length === 0 && errors.length === 0) {
    console.log('\n✅ All test files follow consistent mock patterns!');
  } else {
    console.log('\n💡 Migration guide: tests/__mocks__/MIGRATION_GUIDE.md');
    console.log('   Example: tests/__mocks__/README.md');
  }
  
  // Exit with error code if issues found
  return hasErrors ? 1 : 0;
}

main().then(code => process.exit(code)).catch(error => {
  console.error('Script error:', error);
  process.exit(1);
});