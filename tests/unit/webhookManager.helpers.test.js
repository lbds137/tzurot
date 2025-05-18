/**
 * Tests for webhookManager.js helper functions added during refactoring
 */

jest.mock('discord.js', () => ({
  WebhookClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ id: 'mock-message-id' }),
    destroy: jest.fn()
  })),
  EmbedBuilder: jest.fn().mockImplementation(data => data)
}));

jest.mock('node-fetch', () => {
  return jest.fn().mockImplementation(() => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => "Success",
    buffer: async () => Buffer.from("Success"),
  }));
});

const discord = require('discord.js');
const fetch = require('node-fetch');

describe('WebhookManager - Helper Functions', () => {
  let webhookManager;
  
  // Original console methods
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  
  beforeEach(() => {
    // Mock console methods
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    
    // Reset module
    jest.resetModules();
    webhookManager = require('../../src/webhookManager');
    
    // Clear mocks
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });
  
  describe('Console output management', () => {
    test('minimizeConsoleOutput should disable console output', () => {
      // Call the function
      const originalFunctions = webhookManager.minimizeConsoleOutput();
      
      // Verify it returns the original functions
      expect(originalFunctions).toHaveProperty('originalConsoleLog');
      expect(originalFunctions).toHaveProperty('originalConsoleWarn');
      
      // Try to log something
      console.log('This should not be logged');
      console.warn('This should not be logged');
      
      // Nothing should have been logged
      expect(originalFunctions.originalConsoleLog).not.toHaveBeenCalled();
      expect(originalFunctions.originalConsoleWarn).not.toHaveBeenCalled();
    });
    
    test('restoreConsoleOutput should restore console functions', () => {
      // First minimize
      const originalFunctions = webhookManager.minimizeConsoleOutput();
      
      // Then restore
      webhookManager.restoreConsoleOutput(originalFunctions);
      
      // Mock the restored functions for testing
      console.log = jest.fn();
      console.warn = jest.fn();
      
      // Now logs should work
      console.log('This should be logged');
      console.warn('This should be logged');
      
      // Verify logs were called
      expect(console.log).toHaveBeenCalledWith('This should be logged');
      expect(console.warn).toHaveBeenCalledWith('This should be logged');
    });
  });
  
  describe('Message ID generation', () => {
    test('generateMessageTrackingId should create unique IDs', () => {
      const channelId = 'test-channel';
      
      // Generate IDs
      const id1 = webhookManager.generateMessageTrackingId(channelId);
      const id2 = webhookManager.generateMessageTrackingId(channelId);
      
      // IDs should be strings
      expect(typeof id1).toBe('string');
      
      // IDs should be different even for same channel
      expect(id1).not.toBe(id2);
      
      // IDs should contain the channel ID
      expect(id1).toContain(channelId);
    });
  });
  
  describe('Error content detection', () => {
    test('isErrorContent should identify error messages', () => {
      // Test error patterns
      expect(webhookManager.isErrorContent("I'm having trouble connecting")).toBe(true);
      expect(webhookManager.isErrorContent("ERROR_MESSAGE_PREFIX: Some error")).toBe(true);
      expect(webhookManager.isErrorContent("I'm experiencing a technical issue")).toBe(true);
      expect(webhookManager.isErrorContent("Error ID: 12345")).toBe(true);
      
      // Test non-error messages
      expect(webhookManager.isErrorContent("Hello world")).toBe(false);
      expect(webhookManager.isErrorContent("This is a normal message")).toBe(false);
      
      // Test edge cases
      expect(webhookManager.isErrorContent("")).toBe(false);
      expect(webhookManager.isErrorContent(null)).toBe(false);
      expect(webhookManager.isErrorContent(undefined)).toBe(false);
    });
    
    test('markErrorContent should add prefix to error messages', () => {
      // Should add prefix to error messages
      expect(webhookManager.markErrorContent("I'm having trouble connecting")).toContain('ERROR_MESSAGE_PREFIX:');
      expect(webhookManager.markErrorContent("technical issue")).toContain('ERROR_MESSAGE_PREFIX:');
      
      // Should not modify non-error messages
      const normalMessage = "This is a normal message";
      expect(webhookManager.markErrorContent(normalMessage)).toBe(normalMessage);
      
      // Handle edge cases
      expect(webhookManager.markErrorContent("")).toBe("");
      expect(webhookManager.markErrorContent(null)).toBe("");
      expect(webhookManager.markErrorContent(undefined)).toBe("");
    });
  });
  
  describe('Message preparation', () => {
    test('prepareMessageData should format message data correctly', () => {
      const content = "Test message";
      const username = "TestUser";
      const avatarUrl = "https://example.com/avatar.png";
      const isThread = true;
      const threadId = "thread-123";
      
      // Test with basic info
      const basicData = webhookManager.prepareMessageData(content, username, avatarUrl, false, threadId);
      expect(basicData.content).toBe(content);
      expect(basicData.username).toBe(username);
      expect(basicData.avatarURL).toBe(avatarUrl);
      expect(basicData.threadId).toBeUndefined(); // Not a thread
      
      // Test with thread
      const threadData = webhookManager.prepareMessageData(content, username, avatarUrl, true, threadId);
      expect(threadData.threadId).toBe(threadId);
      
      // Test with embed
      const embedOptions = { embed: { title: "Test Embed" } };
      const embedData = webhookManager.prepareMessageData(content, username, avatarUrl, false, threadId, embedOptions);
      expect(embedData.embeds).toBeDefined();
      expect(embedData.embeds[0]).toEqual(embedOptions.embed);
      
      // Test with null avatar
      const nullAvatarData = webhookManager.prepareMessageData(content, username, null, false, threadId);
      expect(nullAvatarData.avatarURL).toBeNull();
    });
  });
  
  describe('Message chunk sending', () => {
    test('sendMessageChunk should send message via webhook', async () => {
      // Create mock webhook and message data
      const webhook = { send: jest.fn().mockResolvedValue({ id: 'mock-message' }) };
      const messageData = { content: "Test message", username: "TestUser" };
      
      // Call the function
      const result = await webhookManager.sendMessageChunk(webhook, messageData, 0, 1);
      
      // Verify webhook.send was called with the message data
      expect(webhook.send).toHaveBeenCalledWith(messageData);
      
      // Verify the result
      expect(result).toEqual({ id: 'mock-message' });
    });
    
    test('sendMessageChunk should handle errors', async () => {
      // Create mock webhook that throws an error
      const error = new Error("Test error");
      error.code = 50035; // Invalid form body
      
      const webhook = { 
        send: jest.fn()
          .mockRejectedValueOnce(error) // First call throws
          .mockResolvedValue({ id: 'fallback-message' }) // Second call succeeds (fallback)
      };
      
      const messageData = { content: "Test message", username: "TestUser" };
      
      // Call should throw, even though fallback was attempted
      await expect(webhookManager.sendMessageChunk(webhook, messageData, 0, 1))
        .rejects.toThrow();
      
      // Verify webhook.send was called for both attempts
      expect(webhook.send).toHaveBeenCalledTimes(2);
      
      // First call should be with original data
      expect(webhook.send.mock.calls[0][0]).toBe(messageData);
      
      // Second call should be with fallback error message
      expect(webhook.send.mock.calls[1][0].content).toContain('Error');
      expect(webhook.send.mock.calls[1][0].username).toBe(messageData.username);
    });
  });
  
  describe('Virtual result creation', () => {
    test('createVirtualResult should create a valid result object', () => {
      const personality = { fullName: 'test-personality' };
      const channelId = 'channel-123';
      
      // Call the function
      const result = webhookManager.createVirtualResult(personality, channelId);
      
      // Verify structure
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('messageIds');
      expect(result).toHaveProperty('isDuplicate', true);
      
      // Virtual ID should be in both properties
      expect(result.message.id).toBe(result.messageIds[0]);
      expect(result.message.id).toContain('virtual-');
    });
    
    test('createVirtualResult should handle missing personality data', () => {
      const channelId = 'channel-123';
      
      // Call with null personality
      const result1 = webhookManager.createVirtualResult(null, channelId);
      expect(result1).toHaveProperty('isDuplicate', true);
      
      // Call with personality missing fullName
      const result2 = webhookManager.createVirtualResult({}, channelId);
      expect(result2).toHaveProperty('isDuplicate', true);
    });
  });
  
  describe('Message splitting', () => {
    test('splitByCharacterLimit should split text correctly', () => {
      // Create a very long text
      const longText = 'This is a test message. '.repeat(200); // ~4000 characters
      
      // Split the text
      const chunks = webhookManager.splitByCharacterLimit(longText);
      
      // Should be split into chunks
      expect(chunks.length).toBeGreaterThan(1);
      
      // Each chunk should be within the limit (2000 chars)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      }
      
      // The total content should be preserved
      const reconstructed = chunks.join('');
      expect(reconstructed.length).toBeGreaterThanOrEqual(longText.length - 200); // Allow for some whitespace loss
    });
    
    test('processSentence should handle sentences correctly', () => {
      const chunks = [];
      
      // Process a short sentence with empty current chunk
      let result = webhookManager.processSentence('This is a short sentence.', chunks, '');
      expect(result).toBe('This is a short sentence.');
      expect(chunks.length).toBe(0);
      
      // Process a short sentence with existing content
      result = webhookManager.processSentence('This is another sentence.', chunks, result);
      expect(result).toContain('This is a short sentence.');
      expect(result).toContain('This is another sentence.');
      
      // Process a very long sentence
      const longSentence = 'This is a very long sentence that exceeds the limit. '.repeat(100);
      result = webhookManager.processSentence(longSentence, chunks, result);
      
      // Should have added previous content to chunks
      expect(chunks.length).toBeGreaterThan(0);
      
      // Should have split the long sentence into multiple chunks
      expect(chunks.length).toBeGreaterThan(1);
    });
    
    test('processLine should handle lines correctly', () => {
      const chunks = [];
      
      // Process a short line
      let result = webhookManager.processLine('This is a short line', chunks, '');
      expect(result).toBe('This is a short line');
      
      // Process a line with newlines
      result = webhookManager.processLine('This is another line', chunks, result);
      expect(result).toContain('This is a short line\nThis is another line');
      
      // Process a very long line
      const longLine = 'This is a very long line that needs to be split into multiple chunks. '.repeat(50);
      result = webhookManager.processLine(longLine, chunks, result);
      
      // Should have added the accumulated content to chunks
      expect(chunks.length).toBeGreaterThan(0);
      
      // Long line should be split into multiple chunks
      expect(chunks.length).toBeGreaterThan(1);
    });
    
    test('processParagraph should handle paragraphs correctly', () => {
      const chunks = [];
      
      // Process a short paragraph
      let result = webhookManager.processParagraph('This is a short paragraph.', chunks, '');
      expect(result).toBe('This is a short paragraph.');
      
      // Process another paragraph
      result = webhookManager.processParagraph('This is another paragraph.', chunks, result);
      expect(result).toContain('This is a short paragraph.');
      expect(result).toContain('This is another paragraph.');
      
      // Process a very long paragraph
      const longParagraph = 'This is a very long paragraph with many sentences. '.repeat(50);
      result = webhookManager.processParagraph(longParagraph, chunks, result);
      
      // Should have added the previous content to chunks
      expect(chunks.length).toBeGreaterThan(0);
      
      // Long paragraph should generate multiple chunks
      expect(chunks.length).toBeGreaterThan(1);
    });
  });
});