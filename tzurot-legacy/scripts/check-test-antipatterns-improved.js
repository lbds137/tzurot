#!/usr/bin/env node

/**
 * Improved assertion pattern checker that handles false positives
 * for testing throw behavior in domain models
 */

// Improved assertion pattern that allows throw testing
const IMPROVED_ASSERTION_PATTERN = {
  pattern: /expect\s*\(\s*\(\s*\)\s*=>/g,
  check: (match, content, fileContent, lineNumber) => {
    // Get the full line to check context
    const lines = fileContent.split('\n');
    const line = lines[lineNumber - 1] || '';
    
    // Check if this is testing for throw behavior (which is valid)
    const isThrowTest = line.includes('.toThrow') || 
                       line.includes('.rejects') ||
                       lines[lineNumber]?.includes('.toThrow') ||
                       lines[lineNumber]?.includes('.rejects');
    
    // Check if this is testing value object/domain model validation (valid pattern)
    const isDomainValidation = fileContent.includes('domain/') && 
                              (fileContent.includes('ValueObject') || 
                               fileContent.includes('DomainEvent') ||
                               fileContent.includes('Aggregate'));
    
    // Only flag if it's NOT a throw test AND NOT domain validation
    return !isThrowTest && (!isDomainValidation || !line.includes('Error'));
  },
  message: 'Testing function directly. Test what the function does instead. (Exception: testing throw behavior)',
  severity: 'warning'
};

// Example of how to integrate this into the existing check-test-antipatterns.js
console.log(`
To fix the false positives, update the assertions pattern in check-test-antipatterns.js:

Replace the existing pattern at line ~414-419:
    {
      pattern: /expect\\s*\\(\\s*\\(\\s*\\)\\s*=>/g,
      check: () => true,
      message: 'Testing function directly. Test what the function does instead.',
      severity: 'warning'
    }

With this improved version:
    {
      pattern: /expect\\s*\\(\\s*\\(\\s*\\)\\s*=>/g,
      check: (match, content, fileContent, lineNumber) => {
        const lines = fileContent.split('\\n');
        const line = lines[lineNumber - 1] || '';
        const nextLine = lines[lineNumber] || '';
        
        // Allow testing for throw behavior (which is a valid pattern)
        const isThrowTest = line.includes('.toThrow') || 
                           line.includes('.rejects') ||
                           nextLine.includes('.toThrow') ||
                           nextLine.includes('.rejects');
        
        // Allow testing domain model validation
        const isDomainTest = fileContent.includes('domain/') && 
                            line.includes('Error');
        
        return !isThrowTest && !isDomainTest;
      },
      message: 'Testing function directly (unless testing throw behavior).',
      severity: 'warning'
    }
`);

// Alternative: Completely different patterns for domain testing
const DOMAIN_FRIENDLY_PATTERNS = {
  // Pattern that explicitly allows throw testing
  throwTesting: {
    pattern: /expect\s*\(\s*\(\s*\)\s*=>\s*new\s+\w+\([^)]*\)\s*\)\.toThrow/g,
    check: () => false, // Never flag this - it's valid
    message: 'Valid throw test pattern',
    severity: 'none'
  },
  
  // Pattern for value object validation
  valueObjectValidation: {
    pattern: /expect\s*\(\s*\(\s*\)\s*=>\s*new\s+\w+\([^)]*\)\s*\)\.toThrow\(['"`][\w\s]+['"`]\)/g,
    check: () => false, // This is how we test value object validation
    message: 'Valid value object validation test',
    severity: 'none'
  }
};

console.log(`
Or add these exclusion patterns before the general assertion patterns to whitelist valid patterns.
`);