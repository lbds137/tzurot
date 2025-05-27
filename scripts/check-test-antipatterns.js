#!/usr/bin/env node

/**
 * Comprehensive pre-commit hook to check for common anti-patterns in test files
 * Based on issues we've repeatedly encountered and fixed
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Anti-patterns we've encountered and fixed multiple times
const TEST_ANTI_PATTERNS = {
  // 1. Timeout Anti-patterns (from our recent fixes)
  timeouts: [
    {
      pattern: /setTimeout\s*\([^,]+,\s*(\d+)\)/g,
      check: (match, timeout) => parseInt(timeout) > 5000,
      message: 'Found setTimeout with duration > 5 seconds. Use fake timers instead.',
      severity: 'error'
    },
    {
      pattern: /new\s+Promise\s*\(\s*resolve\s*=>\s*setTimeout/g,
      check: () => true,
      message: 'Found Promise with setTimeout. Use fake timers for time-based tests.',
      severity: 'error'
    },
    {
      pattern: /await\s+new\s+Promise\s*\(\s*resolve\s*=>\s*setTimeout/g,
      check: () => true,
      message: 'Waiting for real time in tests. Use jest.useFakeTimers() instead.',
      severity: 'error'
    }
  ],

  // 2. Mock Cleanup Anti-patterns
  mockCleanup: [
    {
      pattern: /jest\.mock\([^)]+\)/g,
      check: (match, content, fileContent) => {
        // Check if there's a corresponding clearAllMocks or resetModules
        return !fileContent.includes('jest.clearAllMocks') && 
               !fileContent.includes('jest.resetModules');
      },
      message: 'Mocks found without cleanup. Add jest.clearAllMocks() in afterEach().',
      severity: 'warning'
    },
    {
      pattern: /\.mockImplementation\(/g,
      check: (match, content, fileContent) => {
        // Check if mock is restored
        return !fileContent.includes('.mockRestore') && 
               !fileContent.includes('jest.restoreAllMocks');
      },
      message: 'Mock implementation without restore. Consider adding mockRestore().',
      severity: 'warning'
    }
  ],

  // 3. Async/Promise Anti-patterns
  async: [
    {
      pattern: /\.then\s*\(\s*\)\s*\.catch/g,
      check: () => true,
      message: 'Empty .then() block. Use async/await instead.',
      severity: 'warning'
    },
    {
      pattern: /expect\s*\([^)]+\)\s*\.resolves/g,
      check: (match, content, fileContent) => {
        // Check if it's awaited
        const line = fileContent.substring(0, fileContent.indexOf(match)).split('\n').length;
        const lines = fileContent.split('\n');
        return !lines[line - 1].trim().startsWith('await');
      },
      message: 'Missing await for .resolves assertion.',
      severity: 'error'
    },
    {
      pattern: /expect\s*\([^)]+\)\s*\.rejects/g,
      check: (match, content, fileContent) => {
        // Check if it's awaited
        const line = fileContent.substring(0, fileContent.indexOf(match)).split('\n').length;
        const lines = fileContent.split('\n');
        return !lines[line - 1].trim().startsWith('await');
      },
      message: 'Missing await for .rejects assertion.',
      severity: 'error'
    }
  ],

  // 4. Test Structure Anti-patterns
  structure: [
    {
      pattern: /it\s*\(\s*['"`]should\s+(.{80,})['"`]/g,
      check: () => true,
      message: 'Test description is too long (>80 chars). Keep it concise.',
      severity: 'warning'
    },
    {
      pattern: /describe\s*\(\s*['"`]['"`]\s*[,)]/g,
      check: () => true,
      message: 'Empty describe block name.',
      severity: 'error'
    },
    {
      pattern: /it\s*\(\s*['"`]['"`]\s*[,)]/g,
      check: () => true,
      message: 'Empty test name.',
      severity: 'error'
    },
    {
      pattern: /\.only\s*\(/g,
      check: () => true,
      message: 'Found .only() - remove before committing.',
      severity: 'error'
    },
    {
      pattern: /\.skip\s*\(/g,
      check: () => true,
      message: 'Found .skip() - consider removing or fixing the test.',
      severity: 'warning'
    }
  ],

  // 5. Console and Debug Anti-patterns
  console: [
    {
      pattern: /console\.(log|info|warn|error|debug)\s*\(/g,
      check: (match, content, fileContent) => {
        // Check if console is mocked
        return !fileContent.includes('jest.spyOn(console') && 
               !fileContent.includes('console.log.mockImplementation');
      },
      message: 'Unmocked console statement in test. Mock console in beforeEach().',
      severity: 'warning'
    },
    {
      pattern: /debugger;/g,
      check: () => true,
      message: 'Found debugger statement.',
      severity: 'error'
    }
  ],

  // 6. Real Data Anti-patterns (from our privacy fixes)
  realData: [
    {
      pattern: /['"`]([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})['"`]/g,
      check: (match, email) => {
        // Check if it's a real-looking email (not test@example.com)
        return !email.includes('example.com') && 
               !email.includes('test.com') &&
               !email.includes('mock');
      },
      message: 'Found potential real email address. Use generic test data.',
      severity: 'warning'
    },
    {
      pattern: /['"`](@[a-zA-Z0-9_]{3,})['"`]/g,
      check: (match, username) => {
        // Check for real-looking usernames
        const testUsernames = ['@test', '@mock', '@fake', '@example', '@user'];
        return !testUsernames.some(test => username.toLowerCase().includes(test));
      },
      message: 'Found potential real username. Use generic test data like @TestUser.',
      severity: 'warning'
    },
    {
      pattern: /https?:\/\/(?!example\.com|localhost|127\.0\.0\.1)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      check: () => true,
      message: 'Found non-example URL. Use example.com for test URLs.',
      severity: 'info'
    }
  ],

  // 7. File System Anti-patterns
  fileSystem: [
    {
      pattern: /fs\.(readFile|writeFile|mkdir|rmdir|unlink)/g,
      check: (match, content, fileContent) => {
        // Check if fs is mocked
        return !fileContent.includes("jest.mock('fs')") && 
               !fileContent.includes("mock('fs')");
      },
      message: 'Unmocked file system operation. Mock fs module.',
      severity: 'error'
    },
    {
      pattern: /process\.cwd\(\)/g,
      check: (match, content, fileContent) => {
        return !fileContent.includes('jest.spyOn(process');
      },
      message: 'Using process.cwd() without mocking. This can cause path issues.',
      severity: 'warning'
    }
  ],

  // 8. Network Request Anti-patterns
  network: [
    {
      pattern: /fetch\s*\(/g,
      check: (match, content, fileContent) => {
        return !fileContent.includes("jest.mock('node-fetch')") && 
               !fileContent.includes("jest.mock('fetch')");
      },
      message: 'Unmocked fetch call. Mock network requests.',
      severity: 'error'
    },
    {
      pattern: /axios\.(get|post|put|delete|patch)/g,
      check: (match, content, fileContent) => {
        return !fileContent.includes("jest.mock('axios')");
      },
      message: 'Unmocked axios call. Mock network requests.',
      severity: 'error'
    }
  ],

  // 9. Memory Leak Anti-patterns
  memory: [
    {
      pattern: /setInterval\s*\(/g,
      check: (match, content, fileContent) => {
        // Check if interval is cleared
        return !fileContent.includes('clearInterval');
      },
      message: 'setInterval without clearInterval. Potential memory leak.',
      severity: 'error'
    },
    {
      pattern: /addEventListener\s*\(/g,
      check: (match, content, fileContent) => {
        return !fileContent.includes('removeEventListener');
      },
      message: 'addEventListener without removeEventListener. Potential memory leak.',
      severity: 'warning'
    }
  ],

  // 10. Test Isolation Anti-patterns
  isolation: [
    {
      pattern: /let\s+(\w+)\s*[;=]/g,
      check: (match, varName, fileContent) => {
        // Check if variable is reassigned without cleanup
        const regex = new RegExp(`${varName}\\s*=`, 'g');
        const assignments = fileContent.match(regex);
        return assignments && assignments.length > 1 && 
               !fileContent.includes(`${varName} = null`) &&
               !fileContent.includes(`${varName} = undefined`);
      },
      message: 'Shared state between tests. Reset in beforeEach/afterEach.',
      severity: 'info'
    }
  ],

  // 11. Implementation Testing Anti-patterns (our biggest problem!)
  implementationTesting: [
    {
      pattern: /expect\s*\([^)]*\._[a-zA-Z]+/g,
      check: () => true,
      message: 'Testing private method/property (starts with _). Test public API instead.',
      severity: 'error'
    },
    {
      pattern: /toHaveBeenCalledWith\s*\([^)]*\).*toHaveBeenCalledWith/gs,
      check: () => true,
      message: 'Multiple toHaveBeenCalledWith on same spy. Consider testing outcome instead.',
      severity: 'warning'
    },
    {
      pattern: /expect\s*\([^)]+\.mock\.calls\[/g,
      check: () => true,
      message: 'Accessing mock.calls directly. Use toHaveBeenCalledWith() instead.',
      severity: 'warning'
    },
    {
      pattern: /expect\s*\([^)]+\)\.toHaveBeenCalledTimes\s*\(\s*[4-9]\d*\s*\)/g,
      check: () => true,
      message: 'Expecting exact high call count. This is brittle - test outcomes instead.',
      severity: 'warning'
    }
  ],

  // 12. Mock Misuse Anti-patterns
  mockMisuse: [
    {
      pattern: /jest\.mock\s*\(['"`]\.\.\/[^'"]+['"`]\)/g,
      check: (match, content, fileContent) => {
        // Check if using __mocks__ directory
        return !fileContent.includes('__mocks__');
      },
      message: 'Mocking relative imports directly. Use __mocks__ directory or factories.',
      severity: 'warning'
    },
    {
      pattern: /mockImplementation\s*\([^)]*\)[\s\S]*?mockImplementation\s*\(/g,
      check: () => true,
      message: 'Multiple mockImplementation calls. Use mockImplementationOnce() for sequences.',
      severity: 'info'
    },
    {
      pattern: /jest\.fn\(\)\.mockResolvedValue\([^)]+\)\.mockRejectedValue/g,
      check: () => true,
      message: 'Conflicting mock setup. Use mockResolvedValueOnce/mockRejectedValueOnce.',
      severity: 'error'
    }
  ],

  // 13. Flaky Test Anti-patterns
  flakyTests: [
    {
      pattern: /expect\s*\([^)]*Date\.now\(\)[^)]*\)/g,
      check: () => true,
      message: 'Testing with Date.now(). Use fixed dates or mock Date.',
      severity: 'error'
    },
    {
      pattern: /expect\s*\([^)]*Math\.random\(\)[^)]*\)/g,
      check: () => true,
      message: 'Testing with Math.random(). Use fixed values or mock.',
      severity: 'error'
    },
    {
      pattern: /\.toBe\s*\(\s*true\s*\).*\.toBe\s*\(\s*false\s*\)/gs,
      check: () => true,
      message: 'Conflicting boolean expectations. Test is likely flaky.',
      severity: 'error'
    },
    {
      pattern: /await\s+.*\n\s*await\s+.*\n\s*await/g,
      check: () => true,
      message: 'Multiple sequential awaits. Consider Promise.all() for parallel execution.',
      severity: 'info'
    }
  ],

  // 14. Discord.js Specific Anti-patterns
  discordPatterns: [
    {
      pattern: /new\s+Client\s*\(/g,
      check: (match, content, fileContent) => {
        return !fileContent.includes('createMockClient') && 
               !fileContent.includes('mockClient');
      },
      message: 'Creating real Discord Client. Use createMockClient() instead.',
      severity: 'error'
    },
    {
      pattern: /message\.channel\.send\s*\(/g,
      check: (match, content, fileContent) => {
        return !fileContent.includes('.mockResolvedValue') && 
               !fileContent.includes('.mockImplementation');
      },
      message: 'Unmocked channel.send(). This should be mocked.',
      severity: 'error'
    },
    {
      pattern: /webhook\.send\s*\(/g,
      check: (match, content, fileContent) => {
        return !fileContent.includes('mockWebhook');
      },
      message: 'Unmocked webhook.send(). Use mock webhooks.',
      severity: 'error'
    }
  ],

  // 15. Test Data Anti-patterns
  testData: [
    {
      pattern: /['"`]personality[0-9]+['"`]/gi,
      check: () => true,
      message: 'Generic personality name. Use descriptive names like "TestAssistant".',
      severity: 'info'
    },
    {
      pattern: /id:\s*['"`]\d{1,3}['"`]/g,
      check: () => true,
      message: 'Short numeric ID. Use realistic Discord snowflake IDs.',
      severity: 'warning'
    },
    {
      pattern: /['"`]test['"`]\s*:\s*['"`]test['"`]/g,
      check: () => true,
      message: 'Lazy test data. Use meaningful test values.',
      severity: 'warning'
    }
  ],

  // 16. Assertion Anti-patterns
  assertions: [
    {
      pattern: /expect\s*\(\s*true\s*\)\.toBe\s*\(\s*true\s*\)/g,
      check: () => true,
      message: 'Tautological assertion. This test always passes.',
      severity: 'error'
    },
    {
      pattern: /expect\s*\([^)]+\)\.toBeDefined\(\)[\s\S]{0,20}expect\s*\([^)]+\)\.toBe\(/g,
      check: () => true,
      message: 'Redundant toBeDefined() before toBe(). toBe() implies defined.',
      severity: 'info'
    },
    {
      pattern: /\.toEqual\s*\(\s*expect\.any\s*\(\s*Object\s*\)\s*\)/g,
      check: () => true,
      message: 'Testing for any object. Be more specific about expected shape.',
      severity: 'warning'
    },
    {
      pattern: /expect\s*\(\s*\(\s*\)\s*=>/g,
      check: () => true,
      message: 'Testing function directly. Test what the function does instead.',
      severity: 'warning'
    }
  ],

  // 17. Module Import Anti-patterns
  imports: [
    {
      pattern: /require\s*\(\s*['"`]\.\.\/\.\.\/\.\.\/src/g,
      check: (match, content, fileContent) => {
        return !fileContent.includes('jest.mock');
      },
      message: 'Importing real src modules without mocking. Tests will be slow.',
      severity: 'error'
    },
    {
      pattern: /import\s+.*\s+from\s+['"`]\.\.\/\.\.\/\.\.\/src.*['"`]/g,
      check: (match, content, fileContent) => {
        const modulePath = match.match(/from\s+['"`]([^'"]+)['"`]/)[1];
        return !fileContent.includes(`jest.mock('${modulePath}')`);
      },
      message: 'ES6 import from src without mocking. Use jest.mock().',
      severity: 'error'
    }
  ]
};

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  
  // Check each category of anti-patterns
  for (const [category, patterns] of Object.entries(TEST_ANTI_PATTERNS)) {
    for (const antiPattern of patterns) {
      let match;
      const regex = new RegExp(antiPattern.pattern.source, antiPattern.pattern.flags);
      
      while ((match = regex.exec(content)) !== null) {
        if (antiPattern.check(match[0], match[1], content)) {
          const line = content.substring(0, match.index).split('\n').length;
          issues.push({
            file: filePath,
            line,
            category,
            severity: antiPattern.severity,
            message: antiPattern.message,
            snippet: match[0].substring(0, 50) + (match[0].length > 50 ? '...' : '')
          });
        }
      }
    }
  }
  
  return issues;
}

function getTestFiles() {
  // Check if files were provided as command line arguments
  const args = process.argv.slice(2);
  if (args.length > 0) {
    // Filter to only test files
    return args.filter(file => file && (file.endsWith('.test.js') || file.endsWith('.spec.js')));
  }
  
  try {
    // Get staged test files
    const stagedFiles = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
      .split('\n')
      .filter(file => file && (file.endsWith('.test.js') || file.endsWith('.spec.js')));
    
    return stagedFiles;
  } catch (error) {
    // If not in a git repo or no staged files, check all test files
    console.log('Not in git repo or no staged files, checking all test files...');
    const testDir = path.join(__dirname, '..', 'tests');
    const files = [];
    
    function walkDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== '__mocks__') {
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
  console.log('🔍 Checking for test anti-patterns...\n');
  
  const testFiles = getTestFiles();
  const issuesByCategory = {};
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfo = 0;
  
  for (const file of testFiles) {
    if (!file || !fs.existsSync(file)) continue;
    
    const issues = checkFile(file);
    for (const issue of issues) {
      if (!issuesByCategory[issue.category]) {
        issuesByCategory[issue.category] = [];
      }
      issuesByCategory[issue.category].push(issue);
      
      if (issue.severity === 'error') totalErrors++;
      else if (issue.severity === 'warning') totalWarnings++;
      else if (issue.severity === 'info') totalInfo++;
    }
  }
  
  // Report issues by category
  for (const [category, issues] of Object.entries(issuesByCategory)) {
    console.log(`\n📋 ${category.toUpperCase()} Issues:`);
    
    // Group by severity
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    const info = issues.filter(i => i.severity === 'info');
    
    if (errors.length > 0) {
      console.log('\n  ❌ Errors:');
      for (const issue of errors) {
        console.log(`    ${issue.file}:${issue.line}`);
        console.log(`      ${issue.message}`);
        console.log(`      Found: ${issue.snippet}`);
      }
    }
    
    if (warnings.length > 0) {
      console.log('\n  ⚠️  Warnings:');
      for (const issue of warnings) {
        console.log(`    ${issue.file}:${issue.line}`);
        console.log(`      ${issue.message}`);
        console.log(`      Found: ${issue.snippet}`);
      }
    }
    
    if (info.length > 0) {
      console.log('\n  ℹ️  Info:');
      for (const issue of info) {
        console.log(`    ${issue.file}:${issue.line}`);
        console.log(`      ${issue.message}`);
      }
    }
  }
  
  // Summary
  console.log('\n📊 Summary:');
  console.log(`  Errors: ${totalErrors}`);
  console.log(`  Warnings: ${totalWarnings}`);
  console.log(`  Info: ${totalInfo}`);
  
  if (totalErrors > 0) {
    console.log('\n❌ Pre-commit check failed! Fix errors before committing.');
    console.log('\n📖 See docs/testing/ for best practices.\n');
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log('\n⚠️  Warnings found. Consider fixing them.');
    console.log('✅ Pre-commit check passed (with warnings).\n');
    process.exit(0);
  } else {
    console.log('\n✅ No anti-patterns found! Great job!\n');
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { checkFile, TEST_ANTI_PATTERNS };