const aiRequestManager = require('../../../src/utils/aiRequestManager');
const { TIME, DEFAULTS } = require('../../../src/constants');

// Mock the logger
jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('aiRequestManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear any state between tests
    aiRequestManager.clearPendingRequests();
    aiRequestManager.clearBlackoutPeriods();
  });

  describe('createRequestId', () => {
    it('should create ID for string message', () => {
      const id = aiRequestManager.createRequestId('einstein', 'Hello world', {
        userId: '123',
        channelId: '456',
      });
      // Now includes hash for better uniqueness
      expect(id).toMatch(/^einstein_123_456_Helloworld_h\d+$/);
    });

    it('should handle empty message', () => {
      const id = aiRequestManager.createRequestId('einstein', '', {
        userId: '123',
        channelId: '456',
      });
      // Empty string is treated as null/undefined
      expect(id).toBe('einstein_123_456_empty-message');
    });

    it('should handle null message', () => {
      const id = aiRequestManager.createRequestId('einstein', null, {
        userId: '123',
        channelId: '456',
      });
      expect(id).toBe('einstein_123_456_empty-message');
    });

    it('should handle multimodal content with text only', () => {
      const content = [{ type: 'text', text: 'What is this?' }];
      const id = aiRequestManager.createRequestId('einstein', content, {
        userId: '123',
        channelId: '456',
      });
      // Now includes hash
      expect(id).toMatch(/^einstein_123_456_Whatisthis\?_h\d+$/);
    });

    it('should handle multimodal content with image', () => {
      const content = [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ];
      const id = aiRequestManager.createRequestId('einstein', content, {
        userId: '123',
        channelId: '456',
      });
      // Now includes hash and uses more chars
      expect(id).toMatch(/^einstein_123_456_Whatisinthisimage\?_h\d+_IMG-image\.jpg$/);
    });

    it('should handle multimodal content with audio', () => {
      const content = [
        { type: 'text', text: 'Transcribe this' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ];
      const id = aiRequestManager.createRequestId('einstein', content, {
        userId: '123',
        channelId: '456',
      });
      expect(id).toMatch(/^einstein_123_456_Transcribethis_h\d+_AUD-audio\.mp3$/);
    });

    it('should handle reference format', () => {
      const message = {
        messageContent: 'My response',
        referencedMessage: {
          content: 'Original message',
        },
      };
      const id = aiRequestManager.createRequestId('einstein', message, {
        userId: '123',
        channelId: '456',
      });
      expect(id).toMatch(/^einstein_123_456_Myresponse_h\d+_ref\d+$/);
    });

    it('should handle reference with media', () => {
      const message = {
        messageContent: 'What about this?',
        referencedMessage: {
          content: '[Image: https://example.com/img.jpg] Check this out',
        },
      };
      const id = aiRequestManager.createRequestId('einstein', message, {
        userId: '123',
        channelId: '456',
      });
      expect(id).toMatch(/^einstein_123_456_Whataboutthis\?_h\d+_ref\d+_IMG-img\.jpg$/);
    });

    it('should use default values for missing context', () => {
      const id = aiRequestManager.createRequestId('einstein', 'Hello', {});
      expect(id).toMatch(
        new RegExp(`^einstein_${DEFAULTS.ANONYMOUS_USER}_${DEFAULTS.NO_CHANNEL}_Hello_h\\d+$`)
      );
    });

    it('should handle complex object gracefully', () => {
      const message = {
        someWeirdProperty: 'value',
      };
      const id = aiRequestManager.createRequestId('einstein', message, {
        userId: '123',
        channelId: '456',
      });
      expect(id).toBe('einstein_123_456_type-object');
    });
  });

  describe('pendingRequests management', () => {
    it('should store and retrieve pending request', async () => {
      const requestId = 'test_request_123';
      const promise = Promise.resolve('test result');

      aiRequestManager.storePendingRequest(requestId, promise);

      const pending = aiRequestManager.getPendingRequest(requestId);
      expect(pending).toBeTruthy();
      expect(pending.promise).toBe(promise);
      expect(pending.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should return null for non-existent request', () => {
      const pending = aiRequestManager.getPendingRequest('non_existent');
      expect(pending).toBeNull();
    });

    it('should remove pending request', () => {
      const requestId = 'test_request_123';
      const promise = Promise.resolve('test result');

      aiRequestManager.storePendingRequest(requestId, promise);
      expect(aiRequestManager.getPendingRequest(requestId)).toBeTruthy();

      aiRequestManager.removePendingRequest(requestId);
      expect(aiRequestManager.getPendingRequest(requestId)).toBeNull();
    });

    it('should clean up timed out requests', () => {
      const requestId = 'test_request_123';
      const promise = Promise.resolve('test result');

      // Store with old timestamp (older than 5 minutes)
      aiRequestManager.pendingRequests.set(requestId, {
        timestamp: Date.now() - TIME.FIVE_MINUTES - 1000,
        promise: promise,
      });

      const pending = aiRequestManager.getPendingRequest(requestId);
      expect(pending).toBeNull();
      expect(aiRequestManager.pendingRequests.has(requestId)).toBe(false);
    });

    it('should track pending requests count', () => {
      expect(aiRequestManager.getPendingRequestsCount()).toBe(0);

      aiRequestManager.storePendingRequest('req1', Promise.resolve());
      aiRequestManager.storePendingRequest('req2', Promise.resolve());

      expect(aiRequestManager.getPendingRequestsCount()).toBe(2);
    });
  });

  describe('blackout period management', () => {
    it('should create blackout key', () => {
      const key = aiRequestManager.createBlackoutKey('einstein', {
        userId: '123',
        channelId: '456',
      });
      expect(key).toBe('einstein_123_456');
    });

    it('should use defaults for missing context', () => {
      const key = aiRequestManager.createBlackoutKey('einstein', {});
      expect(key).toBe(`einstein_${DEFAULTS.ANONYMOUS_USER}_${DEFAULTS.NO_CHANNEL}`);
    });

    it('should add to blackout list with default duration', () => {
      const context = { userId: '123', channelId: '456' };

      aiRequestManager.addToBlackoutList('einstein', context);

      expect(aiRequestManager.isInBlackoutPeriod('einstein', context)).toBe(true);
      expect(aiRequestManager.getBlackoutPeriodsCount()).toBe(1);
    });

    it('should add to blackout list with custom duration', () => {
      const context = { userId: '123', channelId: '456' };
      const customDuration = 5000; // 5 seconds

      aiRequestManager.addToBlackoutList('einstein', context, customDuration);

      expect(aiRequestManager.isInBlackoutPeriod('einstein', context)).toBe(true);
    });

    it('should clean up expired blackout periods', () => {
      const context = { userId: '123', channelId: '456' };
      const key = aiRequestManager.createBlackoutKey('einstein', context);

      // Add with expired timestamp
      aiRequestManager.errorBlackoutPeriods.set(key, Date.now() - 1000);

      expect(aiRequestManager.isInBlackoutPeriod('einstein', context)).toBe(false);
      expect(aiRequestManager.errorBlackoutPeriods.has(key)).toBe(false);
    });

    it('should track blackout periods count', () => {
      expect(aiRequestManager.getBlackoutPeriodsCount()).toBe(0);

      aiRequestManager.addToBlackoutList('einstein', { userId: '123' });
      aiRequestManager.addToBlackoutList('newton', { userId: '456' });

      expect(aiRequestManager.getBlackoutPeriodsCount()).toBe(2);
    });
  });

  describe('prepareRequestHeaders', () => {
    it('should prepare headers with both userId and channelId', () => {
      const headers = aiRequestManager.prepareRequestHeaders({
        userId: '123',
        channelId: '456',
      });

      expect(headers).toEqual({
        'X-User-Id': '123',
        'X-Channel-Id': '456',
      });
    });

    it('should prepare headers with only userId', () => {
      const headers = aiRequestManager.prepareRequestHeaders({
        userId: '123',
      });

      expect(headers).toEqual({
        'X-User-Id': '123',
      });
    });

    it('should prepare headers with only channelId', () => {
      const headers = aiRequestManager.prepareRequestHeaders({
        channelId: '456',
      });

      expect(headers).toEqual({
        'X-Channel-Id': '456',
      });
    });

    it('should return empty object for no context', () => {
      const headers = aiRequestManager.prepareRequestHeaders({});
      expect(headers).toEqual({});
    });
  });

  describe('utility functions', () => {
    it('should clear all pending requests', () => {
      aiRequestManager.storePendingRequest('req1', Promise.resolve());
      aiRequestManager.storePendingRequest('req2', Promise.resolve());

      expect(aiRequestManager.getPendingRequestsCount()).toBe(2);

      aiRequestManager.clearPendingRequests();

      expect(aiRequestManager.getPendingRequestsCount()).toBe(0);
    });

    it('should clear all blackout periods', () => {
      aiRequestManager.addToBlackoutList('einstein', { userId: '123' });
      aiRequestManager.addToBlackoutList('newton', { userId: '456' });

      expect(aiRequestManager.getBlackoutPeriodsCount()).toBe(2);

      aiRequestManager.clearBlackoutPeriods();

      expect(aiRequestManager.getBlackoutPeriodsCount()).toBe(0);
    });
  });
});
