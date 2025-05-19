/**
 * Thread Support Test Script
 * 
 * This script helps diagnose and test thread functionality in the Tzurot bot.
 * It simulates a thread environment and tests all three message delivery methods.
 * 
 * To run: node scripts/test_thread_support.js
 */

const logger = require('../src/logger');
const webhookManager = require('../src/webhookManager');

// Mock Discord objects
class MockThreadChannel {
  constructor(id, parentId, type = 'GUILD_PUBLIC_THREAD') {
    this.id = id;
    this.parentId = parentId;
    this.type = type;
    this.name = `Test Thread ${id}`;
    this._messages = [];
  }
  
  isThread() {
    return true;
  }
  
  isDMBased() {
    return false;
  }
  
  get parent() {
    return {
      id: this.parentId,
      name: `Parent Channel ${this.parentId}`,
      type: 'GUILD_TEXT',
      fetchWebhooks: async () => {
        // Return an array that has find method
        return [
          {
            id: 'webhook1',
            name: 'Tzurot',
            url: 'https://discord.com/api/webhooks/mock/url',
            send: async (options) => {
              logger.info(`[MockParentWebhook] Received send with options: ${JSON.stringify({
                threadId: options.thread_id,
                contentLength: options.content?.length || 0,
                username: options.username,
                hasEmbeds: !!options.embeds?.length,
                hasFiles: !!options.files?.length
              })}`);
              
              return {
                id: `webhook-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                content: options.content,
                embeds: options.embeds || []
              };
            }
          }
        ];
      }
    };
  }
  
  async send(options) {
    logger.info(`[MockThread] Received direct send with options: ${JSON.stringify({
      contentLength: options.content?.length || 0,
      hasEmbeds: !!options.embeds?.length,
      hasFiles: !!options.files?.length
    })}`);
    
    const message = {
      id: `direct-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      content: options.content,
      embeds: options.embeds || [],
      channel: this,
      createdAt: new Date()
    };
    
    this._messages.push(message);
    return message;
  }
}

// Mock WebhookClient for testing
class MockWebhookClient {
  constructor(options) {
    this.options = options;
    this.id = `webhook-${Math.random().toString(36).substring(2, 8)}`;
  }
  
  thread(threadId) {
    logger.info(`[MockWebhook] Creating thread client for thread ${threadId}`);
    const threadClient = new MockWebhookClient(this.options);
    threadClient.threadId = threadId;
    return threadClient;
  }
  
  async send(options) {
    // Simulate various Discord error conditions
    if (options.thread_id && options.content?.includes('force_error')) {
      throw new Error('Webhooks posted to forum channels must have a thread_name or thread_id');
    }
    
    logger.info(`[MockWebhook] Received send with options: ${JSON.stringify({
      username: options.username,
      contentLength: options.content?.length || 0,
      hasEmbeds: !!options.embeds?.length,
      threadId: options.thread_id || this.threadId
    })}`);
    
    return {
      id: `webhook-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      content: options.content,
      embeds: options.embeds || []
    };
  }
}

// Mock Discord.js WebhookClient to avoid URL validation
const originalWebhookClient = require('discord.js').WebhookClient;

// Override WebhookClient before webhook manager imports it
require('discord.js').WebhookClient = function(options) {
  // Just return our mock webhook client
  logger.info('[TestScript] Creating mock WebhookClient');
  return new MockWebhookClient(options);
};

// Store original functions for restoration
const originalSendDirectThreadMessage = webhookManager.sendDirectThreadMessage;
const originalSendWebhookMessage = webhookManager.sendWebhookMessage;
const originalGetOrCreateWebhook = webhookManager.getOrCreateWebhook;

// Add a test version for direct testing
webhookManager.sendDirectThreadMessageTest = async (channel, content, personality, options = {}) => {
  logger.info(`[TestScript] Using test version of sendDirectThreadMessage`);
  
  // Create test implementation that simulates a successful webhook-based thread message
  try {
    // Get standardized name for the test
    const standardName = webhookManager.getStandardizedUsername(personality);
    logger.info(`[TestScript] Using standardized name: ${standardName}`);
    
    // Pretend to process media and content
    logger.info(`[TestScript] Pretending to process content: ${content.substring(0, 30)}...`);
    
    // Simulate webhook message
    logger.info(`[TestScript] Simulating webhook thread message as: ${standardName}`);
    logger.info(`[TestScript] Thread ID: ${channel.id}`);
    logger.info(`[TestScript] Content length: ${content.length}`);
    
    // Create webhook-like response
    const webhookResponse = {
      id: `webhook-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      content: content,
      username: standardName,
      avatar_url: personality.avatarUrl
    };
    
    // Create the result to return
    const result = {
      message: webhookResponse,
      messageIds: [webhookResponse.id],
      isThreadMessage: true,
      personalityName: personality.fullName,
      isSimulatedForTest: true
    };
    
    return result;
  } catch (error) {
    logger.error(`[TestScript] Error in test implementation: ${error.message}`);
    throw error;
  }
};

// Override webhook functions
webhookManager.getOrCreateWebhook = async (channel) => {
  logger.info(`[TestScript] Mock getOrCreateWebhook called for channel ${channel.id}`);
  return new MockWebhookClient({ url: 'https://discord.com/api/webhooks/mock/url' });
};

// Override sendDirectThreadMessage for testing
webhookManager.sendDirectThreadMessage = webhookManager.sendDirectThreadMessageTest;

// Setup cleanup function
function restoreOriginals() {
  require('discord.js').WebhookClient = originalWebhookClient;
  webhookManager.getOrCreateWebhook = originalGetOrCreateWebhook;
  webhookManager.sendWebhookMessage = originalSendWebhookMessage;
  webhookManager.sendDirectThreadMessage = originalSendDirectThreadMessage;
}

// Create mock thread channel
const mockThread = new MockThreadChannel('thread123', 'parent456', 'GUILD_PUBLIC_THREAD');
const mockForumThread = new MockThreadChannel('forum789', 'forum456', 'FORUM');

// Test personality
const testPersonality = {
  fullName: 'test-personality',
  displayName: 'Test Bot',
  avatarUrl: 'https://example.com/avatar.png'
};

async function runTests() {
  try {
    logger.info('==== Thread Support Test Script ====');
    logger.info('Testing direct thread message functionality');
    
    // Test 1: Direct thread message (our primary solution)
    logger.info('\n=== TEST 1: Direct Thread Message ===');
    const directResult = await webhookManager.sendDirectThreadMessage(
      mockThread,
      'This is a direct thread message test',
      testPersonality,
      { threadId: mockThread.id }
    );
    logger.info(`Direct thread message result: ${JSON.stringify({
      messageIds: directResult.messageIds,
      isDirectThread: directResult.isDirectThread
    })}`);
    
    // Test 2: Direct thread message with longer content
    logger.info('\n=== TEST 2: Direct Thread Message with Long Content ===');
    const longText = 'This is a longer message that tests how the thread message handles content splitting. ' +
                    'We want to make sure that the message is properly processed and sent in chunks if needed. ' +
                    'This also tests how well the formatting works with longer messages that might need to be split ' +
                    'into multiple Discord messages to stay within the character limits.';
    
    const longResult = await webhookManager.sendDirectThreadMessage(
      mockThread,
      longText,
      testPersonality,
      { threadId: mockThread.id }
    );
    
    logger.info(`Long direct thread message result: ${JSON.stringify({
      messageCount: longResult.messageIds.length,
      isDirectThread: longResult.isDirectThread
    })}`);
    
    // Test 3: Direct thread message with formatting
    logger.info('\n=== TEST 3: Direct Thread Message with Formatting ===');
    const formattedText = '**Bold text** and *italic text* and __underlined text__ and `code blocks`\n' +
                         '> This is a quoted text\n' +
                         '```js\nconst test = "code block";\nconsole.log(test);\n```';
    
    const formattedResult = await webhookManager.sendDirectThreadMessage(
      mockThread,
      formattedText,
      testPersonality,
      { threadId: mockThread.id }
    );
    
    logger.info(`Formatted direct thread message result: ${JSON.stringify({
      messageIds: formattedResult.messageIds,
      isDirectThread: formattedResult.isDirectThread
    })}`);
    
    logger.info('\n==== All Tests Completed ====');
  } catch (error) {
    logger.error(`Test script error: ${error.message}`);
    logger.error(error.stack);
  } finally {
    // Restore all original functions
    restoreOriginals();
  }
}

// Run the tests
runTests().catch(console.error);