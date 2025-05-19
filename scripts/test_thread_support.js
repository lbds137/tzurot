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
            url: 'https://discord.com/api/webhooks/mock/url'
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
const { WebhookClient } = require('discord.js');
const originalWebhookClient = WebhookClient;

// Create a test-friendly version of WebhookClient
global.WebhookClient = MockWebhookClient;

// Mock the entire webhook system
const originalSendWebhookMessage = webhookManager.sendWebhookMessage;
const originalGetOrCreateWebhook = webhookManager.getOrCreateWebhook;

// Override webhook functions
webhookManager.getOrCreateWebhook = async (channel) => {
  logger.info(`[TestScript] Mock getOrCreateWebhook called for channel ${channel.id}`);
  return new MockWebhookClient({ url: 'https://discord.com/api/webhooks/mock/url' });
};

// Setup cleanup function
function restoreOriginals() {
  global.WebhookClient = originalWebhookClient;
  webhookManager.getOrCreateWebhook = originalGetOrCreateWebhook;
  webhookManager.sendWebhookMessage = originalSendWebhookMessage;
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