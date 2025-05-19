/**
 * Test script for webhook proxy detection
 * 
 * This script tests the webhook proxy detection logic in webhookUserTracker.js
 * with various mock webhook messages to ensure the detection works correctly.
 */

const logger = require('../src/logger');
const webhookUserTracker = require('../src/utils/webhookUserTracker');

// Ensure we're in debug mode for detailed logging
logger.level = 'debug';

// Create mock messages for testing
function createMockWebhookMessage({ 
  webhookId = '123456789', 
  applicationId = null,
  username = 'Test User',
  content = 'Hello world',
  embeds = [],
  member = null
}) {
  return {
    webhookId,
    applicationId,
    author: { username, id: '987654321' },
    content,
    embeds,
    member
  };
}

// Test cases
const testCases = [
  {
    name: 'PluralKit by application ID',
    message: createMockWebhookMessage({ 
      webhookId: '111111111',
      applicationId: '466378653216014359', // PluralKit's application ID
      username: 'Some Random Username'
    }),
    expectation: true
  },
  {
    name: 'PluralKit by username',
    message: createMockWebhookMessage({ 
      webhookId: '222222222',
      username: 'John (PluralKit)'
    }),
    expectation: true
  },
  {
    name: 'PluralKit by system ID in embed',
    message: createMockWebhookMessage({ 
      webhookId: '333333333',
      username: 'John Smith',
      embeds: [
        { 
          title: 'System Info',
          fields: [
            { name: 'System ID', value: 'abcdef' }
          ]
        }
      ]
    }),
    expectation: true
  },
  {
    name: 'PluralKit by pk: prefix in content',
    message: createMockWebhookMessage({ 
      webhookId: '444444444',
      username: 'Jane Doe',
      content: 'This message contains a pk:abcdef reference'
    }),
    expectation: true
  },
  {
    name: 'Normal webhook (not proxy)',
    message: createMockWebhookMessage({ 
      webhookId: '555555555',
      username: 'Regular Webhook'
    }),
    expectation: false
  },
  {
    name: 'Bot command from webhook',
    message: createMockWebhookMessage({ 
      webhookId: '666666666',
      username: 'Regular Webhook',
      content: '!tz help'
    }),
    expectation: false // Not a proxy, but should bypass verification for commands
  }
];

// Run the tests
console.log('\n=== WEBHOOK PROXY DETECTION TESTS ===\n');

let passedTests = 0;
let failedTests = 0;

testCases.forEach(test => {
  console.log(`Testing: ${test.name}`);
  
  // Test isProxySystemWebhook
  const isProxy = webhookUserTracker.isProxySystemWebhook(test.message);
  console.log(`  isProxySystemWebhook: ${isProxy}`);
  
  const testResult = isProxy === test.expectation;
  if (testResult) {
    console.log('  ✅ PASS');
    passedTests++;
  } else {
    console.log('  ❌ FAIL - Expected:', test.expectation, 'Got:', isProxy);
    failedTests++;
  }
  
  // Also test shouldBypassNsfwVerification
  const shouldBypass = webhookUserTracker.shouldBypassNsfwVerification(test.message);
  console.log(`  shouldBypassNsfwVerification: ${shouldBypass}`);
  
  // Special case: Bot commands should bypass verification even if not a proxy system
  const bypassExpectation = test.expectation || 
                          (test.message.content && test.message.content.startsWith('!tz'));
                          
  const bypassTestResult = shouldBypass === bypassExpectation;
  if (bypassTestResult) {
    console.log('  ✅ PASS (verification bypass)');
    passedTests++;
  } else {
    console.log('  ❌ FAIL (verification bypass) - Expected:', bypassExpectation, 'Got:', shouldBypass);
    failedTests++;
  }
  
  console.log('-----------------------------------');
});

// Show summary
console.log(`\nTest Summary: ${passedTests} passed, ${failedTests} failed\n`);
if (failedTests === 0) {
  console.log('🎉 All webhook proxy detection tests passed!');
} else {
  console.log('❌ Some tests failed. Please check the issues above.');
}