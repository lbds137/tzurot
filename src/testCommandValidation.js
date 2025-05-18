/**
 * Test Command Validation
 * This file tests the command validation middleware in isolation without external dependencies
 */

const { validateCommandMiddleware, validationRules } = require('./commandValidation');

// Test cases for different commands with valid and invalid arguments
const testCases = [
  // add command tests
  {
    name: 'add command - valid',
    command: 'add',
    args: { profileName: 'testProfile', alias: 'test' },
    shouldPass: true
  },
  {
    name: 'add command - missing required param',
    command: 'add',
    args: { alias: 'test' },
    shouldPass: false
  },
  {
    name: 'add command - invalid type',
    command: 'add',
    args: { profileName: 123, alias: 'test' },
    shouldPass: false  // The validation is strict and rejects number values
  },
  
  // alias command tests
  {
    name: 'alias command - valid',
    command: 'alias',
    args: { profileName: 'testProfile', newAlias: 'testAlias' },
    shouldPass: true
  },
  {
    name: 'alias command - missing newAlias',
    command: 'alias',
    args: { profileName: 'testProfile' },
    shouldPass: false
  },
  
  // remove command tests
  {
    name: 'remove command - valid',
    command: 'remove',
    args: { profileName: 'testProfile' },
    shouldPass: true
  },
  {
    name: 'remove command - missing profileName',
    command: 'remove',
    args: {},
    shouldPass: false
  },
  
  // info command tests
  {
    name: 'info command - valid',
    command: 'info',
    args: { profileName: 'testProfile' },
    shouldPass: true
  },
  {
    name: 'info command - missing profileName',
    command: 'info',
    args: {},
    shouldPass: false
  },
  
  // activate command tests
  {
    name: 'activate command - valid',
    command: 'activate',
    args: { personalityName: 'friendly' },
    shouldPass: true
  },
  {
    name: 'activate command - missing personalityName',
    command: 'activate',
    args: {},
    shouldPass: false
  },
  
  // autorespond command tests
  {
    name: 'autorespond command - valid on',
    command: 'autorespond',
    args: { status: 'on' },
    shouldPass: true
  },
  {
    name: 'autorespond command - valid off',
    command: 'autorespond',
    args: { status: 'off' },
    shouldPass: true
  },
  {
    name: 'autorespond command - valid status',
    command: 'autorespond',
    args: { status: 'status' },
    shouldPass: true
  },
  {
    name: 'autorespond command - invalid status',
    command: 'autorespond',
    args: { status: 'invalid' },
    shouldPass: false
  },
  
  // Unregistered command (no validation rules)
  {
    name: 'unknown command - should pass without validation',
    command: 'unknownCommand',
    args: { foo: 'bar' },
    shouldPass: true
  }
];

/**
 * Tests the validation middleware in isolation
 * @returns {Object} - Test results with counts
 */
function testValidationMiddleware() {
  console.log('\n========== TESTING VALIDATION MIDDLEWARE ==========\n');
  
  let passCount = 0;
  let failCount = 0;
  
  testCases.forEach(test => {
    const result = validateCommandMiddleware(test.command, test.args);
    const passed = result.success === test.shouldPass;
    
    console.log(`Test: ${test.name}`);
    console.log(`Command: ${test.command}, Args: ${JSON.stringify(test.args)}`);
    console.log(`Expected: ${test.shouldPass ? 'PASS' : 'FAIL'}, Actual: ${result.success ? 'PASS' : 'FAIL'}`);
    
    if (!result.success) {
      console.log(`Errors: ${result.message}`);
    }
    
    console.log(`Result: ${passed ? '✅ PASSED' : '❌ FAILED'}\n`);
    
    if (passed) passCount++;
    else failCount++;
  });
  
  console.log(`Validation Middleware Tests: ${passCount} passed, ${failCount} failed`);
  return { passCount, failCount };
}

/**
 * Converts array arguments to named parameters based on command validation rules
 * This is a simplified version of the function in middleware.js
 * @param {string} command - Command name
 * @param {Array} args - Array of command arguments
 * @returns {Object} - Named parameters object
 */
function convertArgsToNamedParams(command, args) {
  // If no rules exist for this command, return args as is
  if (!validationRules[command]) {
    return { _raw: args };
  }
  
  const rules = validationRules[command];
  const namedArgs = {};
  
  // Map the positional arguments to named parameters based on required and optional arrays
  const paramNames = [...(rules.required || []), ...(rules.optional || [])];
  
  paramNames.forEach((paramName, index) => {
    if (index < args.length) {
      namedArgs[paramName] = args[index];
    }
  });
  
  // Store the raw args as well
  namedArgs._raw = args;
  
  return namedArgs;
}

/**
 * Tests the arguments conversion function
 */
function testArgsConversion() {
  console.log('\n========== TESTING ARGS CONVERSION ==========\n');
  
  let passCount = 0;
  let failCount = 0;
  
  const conversionTests = [
    {
      name: 'Add command args conversion',
      command: 'add',
      rawArgs: ['testProfile', 'testAlias'],
      expected: { profileName: 'testProfile', alias: 'testAlias' }
    },
    {
      name: 'Alias command args conversion',
      command: 'alias',
      rawArgs: ['testProfile', 'newAlias'],
      expected: { profileName: 'testProfile', newAlias: 'newAlias' }
    },
    {
      name: 'Remove command args conversion',
      command: 'remove',
      rawArgs: ['testProfile'],
      expected: { profileName: 'testProfile' }
    },
    {
      name: 'Unknown command args conversion',
      command: 'unknown',
      rawArgs: ['param1', 'param2'],
      expected: { _raw: ['param1', 'param2'] }
    }
  ];
  
  conversionTests.forEach(test => {
    console.log(`Test: ${test.name}`);
    const result = convertArgsToNamedParams(test.command, test.rawArgs);
    
    // Remove _raw from result for comparison
    const { _raw, ...convertedArgs } = result;
    
    // Remove _raw from expected if it exists
    const { _raw: expectedRaw, ...expectedArgs } = test.expected;
    
    const argsMatch = JSON.stringify(convertedArgs) === JSON.stringify(expectedArgs);
    
    console.log(`Command: ${test.command}, Raw Args: ${JSON.stringify(test.rawArgs)}`);
    console.log(`Expected: ${JSON.stringify(expectedArgs)}`);
    console.log(`Actual: ${JSON.stringify(convertedArgs)}`);
    console.log(`Result: ${argsMatch ? '✅ PASSED' : '❌ FAILED'}\n`);
    
    if (argsMatch) passCount++;
    else failCount++;
  });
  
  console.log(`Args Conversion Tests: ${passCount} passed, ${failCount} failed`);
  return { passCount, failCount };
}

/**
 * Tests the end-to-end validation flow
 */
function testEndToEndValidation() {
  console.log('\n========== TESTING END-TO-END VALIDATION ==========\n');
  
  let passCount = 0;
  let failCount = 0;
  
  // Tests that simulate the entire validation process
  // 1. Convert array args to named args
  // 2. Validate the named args
  
  const e2eTests = [
    {
      name: 'Add command - valid end-to-end',
      command: 'add',
      rawArgs: ['testProfile', 'testAlias'],
      shouldPass: true
    },
    {
      name: 'Add command - missing required param',
      command: 'add',
      rawArgs: [],
      shouldPass: false
    },
    {
      name: 'Alias command - valid end-to-end',
      command: 'alias',
      rawArgs: ['testProfile', 'newAlias'],
      shouldPass: true
    },
    {
      name: 'Alias command - missing newAlias',
      command: 'alias',
      rawArgs: ['testProfile'],
      shouldPass: false
    },
    {
      name: 'Autorespond command - valid value',
      command: 'autorespond',
      rawArgs: ['on'],
      shouldPass: true
    },
    {
      name: 'Autorespond command - invalid value',
      command: 'autorespond',
      rawArgs: ['somevalue'],
      shouldPass: false
    }
  ];
  
  e2eTests.forEach(test => {
    console.log(`Test: ${test.name}`);
    
    // Step 1: Convert args
    const namedArgs = convertArgsToNamedParams(test.command, test.rawArgs);
    
    // Step 2: Validate
    const result = validateCommandMiddleware(test.command, namedArgs);
    const passed = result.success === test.shouldPass;
    
    console.log(`Command: ${test.command}, Raw Args: ${JSON.stringify(test.rawArgs)}`);
    console.log(`Converted Args: ${JSON.stringify(namedArgs)}`);
    console.log(`Expected: ${test.shouldPass ? 'PASS' : 'FAIL'}, Actual: ${result.success ? 'PASS' : 'FAIL'}`);
    
    if (!result.success) {
      console.log(`Errors: ${result.message}`);
    }
    
    console.log(`Result: ${passed ? '✅ PASSED' : '❌ FAILED'}\n`);
    
    if (passed) passCount++;
    else failCount++;
  });
  
  console.log(`End-to-End Validation Tests: ${passCount} passed, ${failCount} failed`);
  return { passCount, failCount };
}

/**
 * Run all tests and report results
 */
function runAllTests() {
  console.log('======================================================');
  console.log('     COMMAND VALIDATION TESTS WITHOUT DEPENDENCIES    ');
  console.log('======================================================');
  console.log('\nAvailable validation rules for commands:');
  console.log(Object.keys(validationRules).join(', '));
  
  // Run all test suites
  const validationResults = testValidationMiddleware();
  const conversionResults = testArgsConversion();
  const e2eResults = testEndToEndValidation();
  
  // Report overall results
  console.log('\n======================================================');
  console.log('                    TEST SUMMARY                      ');
  console.log('======================================================');
  console.log(`Validation Tests: ${validationResults.passCount} passed, ${validationResults.failCount} failed`);
  console.log(`Args Conversion Tests: ${conversionResults.passCount} passed, ${conversionResults.failCount} failed`);
  console.log(`End-to-End Tests: ${e2eResults.passCount} passed, ${e2eResults.failCount} failed`);
  
  const totalPassed = validationResults.passCount + conversionResults.passCount + e2eResults.passCount;
  const totalFailed = validationResults.failCount + conversionResults.failCount + e2eResults.failCount;
  const totalTests = totalPassed + totalFailed;
  
  console.log(`\nTOTAL: ${totalPassed}/${totalTests} (${Math.round(totalPassed/totalTests*100)}%) tests passed`);
  
  if (totalFailed > 0) {
    console.log('\n❌ Some tests failed. Please check the detailed results above.');
  } else {
    console.log('\n✅ All tests passed successfully!');
  }
}

// Run the tests when this file is executed directly
if (require.main === module) {
  runAllTests();
}

// Export for potential use in other test frameworks
module.exports = {
  testValidationMiddleware,
  testArgsConversion,
  testEndToEndValidation,
  runAllTests
};