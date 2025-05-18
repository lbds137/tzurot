/**
 * Test script for message deduplication.
 * 
 * This script simulates multiple identical messages being sent within a short timeframe
 * to verify that the deduplication mechanisms properly prevent duplicate messages.
 */

// Use the simplified version for testing
const botPath = process.argv[2] === 'simplified' 
  ? '../src/bot.js.simplified'
  : '../src/bot.js';

// Import the bot code dynamically based on the path
const { initBot } = require(botPath);

// Mock Discord.js classes
class MockClient {
  constructor() {
    this.user = { tag: 'TestBot#1234', setActivity: jest.fn() };
    this.channels = { cache: new Map() };
    this.login = jest.fn().mockResolvedValue('mock-token');
    this.on = jest.fn();
    this.emit = jest.fn();
  }
}

class MockMessage {
  constructor(id, content, author) {
    this.id = id;
    this.content = content;
    this.author = author;
    this.channel = new MockChannel('test-channel');
    this.reply = jest.fn().mockImplementation(async (options) => {
      console.log(`Reply to message ${this.id}: ${typeof options === 'string' ? options : 'complex options'}`);
      return { id: `reply-to-${this.id}`, content: options };
    });
  }
}

class MockChannel {
  constructor(id) {
    this.id = id;
    this.send = jest.fn().mockImplementation(async (options) => {
      console.log(`Send to channel ${this.id}: ${typeof options === 'string' ? options : 'complex options'}`);
      return { id: `message-in-${this.id}`, content: options };
    });
    this.sendTyping = jest.fn().mockResolvedValue(undefined);
  }
}

// Mock the Discord.js module
jest.mock('discord.js', () => {
  const original = jest.requireActual('discord.js');
  return {
    ...original,
    Client: MockClient,
    Message: MockMessage,
    TextChannel: MockChannel
  };
});

// Mock environment variables
process.env.DISCORD_TOKEN = 'mock-token';

// Run the test
async function runTest() {
  console.log(`Testing deduplication using: ${botPath}`);
  
  // Initialize the bot
  const client = await initBot();
  
  // Find the 'ready' event handler and call it
  const readyHandler = client.on.mock.calls.find(call => call[0] === 'ready')[1];
  await readyHandler();
  
  console.log('Bot initialized. Testing deduplication...');
  
  // Create a test message
  const message = new MockMessage(
    'test-msg-1',
    'Hello, bot!',
    { id: 'user-123', bot: false, tag: 'TestUser#1234' }
  );
  
  // Call reply multiple times in quick succession
  console.log('\nTesting Message.prototype.reply deduplication:');
  const replies = await Promise.all([
    message.reply('Duplicate message 1'),
    message.reply('Duplicate message 1'), // Should be deduplicated
    message.reply('Duplicate message 1'), // Should be deduplicated
    message.reply('Different message'),   // Should be processed normally
  ]);
  
  console.log('\nReply results:');
  replies.forEach((reply, index) => {
    console.log(`Reply ${index + 1}: ${reply.isDuplicate ? 'DUPLICATE' : 'PROCESSED'} (ID: ${reply.id})`);
  });
  
  // Test channel.send deduplication
  console.log('\nTesting TextChannel.prototype.send deduplication:');
  const channel = new MockChannel('test-channel-1');
  
  const messages = await Promise.all([
    channel.send('Duplicate channel message'),
    channel.send('Duplicate channel message'), // Should be deduplicated
    channel.send('Duplicate channel message'), // Should be deduplicated
    channel.send('Different channel message'), // Should be processed normally
  ]);
  
  console.log('\nChannel send results:');
  messages.forEach((msg, index) => {
    console.log(`Message ${index + 1}: ${msg.isDuplicate ? 'DUPLICATE' : 'PROCESSED'} (ID: ${msg.id})`);
  });
  
  // Test message tracking
  console.log('\nTest complete.');
}

// Run the test
runTest().catch(error => {
  console.error('Test failed:', error);
});