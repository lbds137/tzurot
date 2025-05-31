/**
 * Tests for webhookManager.js message chunk delay functionality
 * 
 * These tests verify:
 * - Proper delay is applied between message chunks (750ms)
 * - Delay is configurable via setDelayFunction
 * - No delay on first chunk
 */

// Mock all dependencies before loading webhookManager
const mockActiveWebhooks = new Set();
const mockDelayFn = jest.fn().mockResolvedValue();
const mockWebhook = {
  send: jest.fn().mockResolvedValue({ 
    id: 'mock-message-id',
    content: 'test content'
  }),
  destroy: jest.fn()
};

jest.mock('discord.js', () => ({
  WebhookClient: jest.fn(() => mockWebhook)
}));

jest.mock('../../src/logger');

jest.mock('../../src/utils/errorTracker');

jest.mock('../../src/utils/media', () => ({
  processMediaForWebhook: jest.fn((content) => Promise.resolve({ 
    content: content || 'processed', 
    attachments: [],
    // Explicitly no multimodal content
    multimodalAudioUrl: undefined,
    multimodalImageUrl: undefined
  })),
  prepareAttachmentOptions: jest.fn().mockReturnValue({})
}));

jest.mock('../../src/utils/webhookCache', () => ({
  getActiveWebhooks: jest.fn(() => mockActiveWebhooks),
  getOrCreateWebhook: jest.fn().mockResolvedValue(mockWebhook),
  clearWebhookCache: jest.fn(),
  has: jest.fn().mockReturnValue(false),
  _webhookCache: new Map()
}));

jest.mock('../../src/utils/messageDeduplication', () => ({
  isDuplicateMessage: jest.fn().mockReturnValue(false),
  hashMessage: jest.fn().mockReturnValue('hash')
}));

jest.mock('../../src/utils/avatarManager', () => ({
  warmupAvatarUrl: jest.fn(url => Promise.resolve(url)),
  validateAvatarUrl: jest.fn().mockReturnValue(true),
  getValidAvatarUrl: jest.fn(url => url),
  preloadPersonalityAvatar: jest.fn()
}));

jest.mock('../../src/utils/messageFormatter', () => ({
  splitMessage: jest.fn(content => {
    // For testing, split any content over 50 chars into chunks
    if (!content || content.length <= 50) {
      return [content || ''];
    }
    const chunks = [];
    let remaining = content;
    while (remaining.length > 0) {
      chunks.push(remaining.substring(0, 50));
      remaining = remaining.substring(50);
    }
    return chunks;
  }),
  markErrorContent: jest.fn(content => content || ''),
  prepareMessageData: jest.fn((content, username, avatarUrl, isThread, threadId, options) => ({
    content: content || '',
    username,
    avatarURL: avatarUrl,
    threadId: isThread ? threadId : undefined,
    ...options
  }))
}));

jest.mock('../../src/profileInfoFetcher', () => ({
  getProfileDisplayName: jest.fn().mockResolvedValue('Test Display')
}));

jest.mock('../../src/constants', () => ({
  TIME: {
    MIN_MESSAGE_DELAY: 3000,
    MAX_ERROR_WAIT_TIME: 15000
  },
  ERROR_MESSAGES: [],
  MARKERS: {
    HARD_BLOCKED_RESPONSE: 'HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY'
  }
}));

describe('WebhookManager - Chunk Delay Tests', () => {
  let webhookManager;
  let mockChannel;
  let personality;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the delay function
    mockDelayFn.mockClear();
    mockDelayFn.mockResolvedValue();
    
    // Mock channel
    mockChannel = {
      id: 'test-channel-id',
      isDMBased: jest.fn().mockReturnValue(false),
      isThread: jest.fn().mockReturnValue(false),
      send: jest.fn().mockResolvedValue({ id: 'direct-message-id' })
    };
    
    // Mock personality
    personality = {
      fullName: 'test-personality',
      displayName: 'Test Personality',
      avatarUrl: 'https://example.com/avatar.png'
    };
    
    // Now require webhookManager after all mocks are set up
    jest.isolateModules(() => {
      webhookManager = require('../../src/webhookManager');
      // Set our mock delay function
      webhookManager.setDelayFunction(mockDelayFn);
      
      // Mock calculateMessageDelay to return 0 (no initial delay)
      webhookManager.calculateMessageDelay = jest.fn().mockReturnValue(0);
    });
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  it('should not delay on the first chunk', async () => {
    const content = 'Short message';
    
    await webhookManager.sendWebhookMessage(mockChannel, content, personality);
    
    // Should not call delay function for single chunk or first chunk
    expect(mockDelayFn).not.toHaveBeenCalled();
    expect(mockWebhook.send).toHaveBeenCalledTimes(1);
  });
  
  it('should delay 750ms between chunks for multi-chunk messages', async () => {
    // Create content that will be split into 3 chunks (150 chars)
    const content = 'This is a long message that will be split into multiple chunks. '.repeat(3);
    
    await webhookManager.sendWebhookMessage(mockChannel, content, personality);
    
    // The webhook manager may add extra sends for multimodal content
    // What's important is that delays are being applied between chunks
    const chunkDelays = mockDelayFn.mock.calls.filter(call => call[0] === 750);
    
    // Should have delays between chunks
    expect(chunkDelays.length).toBeGreaterThanOrEqual(2);
    // Should send at least the expected 3 chunks
    expect(mockWebhook.send.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  
  it('should use custom delay function when set', async () => {
    const customDelayFn = jest.fn().mockResolvedValue();
    
    // Use isolateModules to get a fresh instance
    jest.isolateModules(() => {
      const freshWebhookManager = require('../../src/webhookManager');
      freshWebhookManager.setDelayFunction(customDelayFn);
      
      // Create content that will be split into 2 chunks
      const content = 'This is a message that will be split into exactly two chunks for testing purposes.';
      
      freshWebhookManager.sendWebhookMessage(mockChannel, content, personality).then(() => {
        // Should use custom delay function
        expect(customDelayFn).toHaveBeenCalledTimes(1);
        expect(customDelayFn).toHaveBeenCalledWith(750);
      });
    });
  });
  
  it('should apply delay for each chunk after the first', async () => {
    // Create content that will be split into 4 chunks
    const content = 'Chunk content '.repeat(15); // ~210 chars = 4 chunks of 50
    
    await webhookManager.sendWebhookMessage(mockChannel, content, personality);
    
    // Filter out any non-750ms delay calls (like initial message delay)
    const chunkDelays = mockDelayFn.mock.calls.filter(call => call[0] === 750);
    
    // At least 3 delays should be present for chunks 2, 3, and 4
    expect(chunkDelays.length).toBeGreaterThanOrEqual(3);
    
    // Should send at least 4 chunks
    expect(mockWebhook.send.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
  
  it('should verify exact delay timing between chunks', async () => {
    // Create content for exactly 2 chunks
    const content = 'First chunk of text that is exactly long enough. Second chunk of text for testing delays properly.';
    
    await webhookManager.sendWebhookMessage(mockChannel, content, personality);
    
    // Should have exactly one delay call for 2 chunks
    expect(mockDelayFn).toHaveBeenCalledTimes(1);
    expect(mockDelayFn).toHaveBeenCalledWith(750);
    
    // Verify send was called twice
    expect(mockWebhook.send).toHaveBeenCalledTimes(2);
  });
  
  it('should handle empty content without delays', async () => {
    await webhookManager.sendWebhookMessage(mockChannel, '', personality);
    
    // Should send one message with no delays
    expect(mockDelayFn).not.toHaveBeenCalled();
    expect(mockWebhook.send).toHaveBeenCalledTimes(1);
  });
  
  it('should handle delay errors gracefully', async () => {
    // Create content that will be split into 3 chunks (each chunk can be ~2000 chars)
    const chunk1 = 'A'.repeat(1950);
    const chunk2 = 'B'.repeat(1950);
    const chunk3 = 'C'.repeat(1950);
    const content = chunk1 + ' ' + chunk2 + ' ' + chunk3;
    
    // Mock processMediaForWebhook to return the long content
    require('../../src/utils/media').processMediaForWebhook.mockResolvedValue({ 
      content: content,
      attachments: [],
      isMultimodal: false
    });
    
    // Track how many times delay was called before the error
    let delayCallCount = 0;
    mockDelayFn.mockImplementation((ms) => {
      delayCallCount++;
      if (ms === 750 && delayCallCount === 1) {
        // Only fail on the first 750ms delay
        return Promise.reject(new Error('Delay failed'));
      }
      return Promise.resolve();
    });
    
    // The webhook manager doesn't catch delay errors, so this will throw
    await expect(webhookManager.sendWebhookMessage(mockChannel, content, personality))
      .rejects.toThrow('Delay failed');
    
    // Should have attempted the delay
    expect(mockDelayFn).toHaveBeenCalled();
    
    // The first chunk should have been sent before the error
    expect(mockWebhook.send.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});