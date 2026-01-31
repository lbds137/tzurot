/**
 * Tests for webhookUserTracker.js
 */

const { botPrefix } = require('../../../config');

describe('webhookUserTracker', () => {
  let webhookUserTracker;
  let mockLogger;
  let mockConfig;
  let dateNowSpy;

  // Clear all timer mocks before each test to prevent interference
  beforeEach(() => {
    jest.clearAllTimers();
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    // Mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    jest.doMock('../../../src/logger', () => mockLogger);

    // Mock config
    mockConfig = {
      botPrefix,
    };
    jest.doMock('../../../config', () => mockConfig);

    // Mock Date.now for consistent timestamps
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000000);

    // Import after mocking
    webhookUserTracker = require('../../../src/utils/webhookUserTracker');
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    dateNowSpy.mockRestore();
  });

  describe('associateWebhookWithUser', () => {
    it('should associate webhook with user', () => {
      webhookUserTracker.associateWebhookWithUser('webhook123', 'user456');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[WebhookUserTracker] Associated webhook webhook123 with user user456'
      );
    });

    it('should not associate if webhookId is missing', () => {
      webhookUserTracker.associateWebhookWithUser(null, 'user456');
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('should not associate if userId is missing', () => {
      webhookUserTracker.associateWebhookWithUser('webhook123', null);
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('should update existing association', () => {
      webhookUserTracker.associateWebhookWithUser('webhook123', 'user456');
      webhookUserTracker.associateWebhookWithUser('webhook123', 'user789');

      const result = webhookUserTracker.getRealUserIdFromWebhook('webhook123');
      expect(result).toBe('user789');
    });
  });

  describe('getRealUserIdFromWebhook', () => {
    it('should return null for missing webhookId', () => {
      const result = webhookUserTracker.getRealUserIdFromWebhook(null);
      expect(result).toBeNull();
    });

    it('should return null for unknown webhook', () => {
      const result = webhookUserTracker.getRealUserIdFromWebhook('unknown');
      expect(result).toBeNull();
    });

    it('should return user ID for known webhook', () => {
      webhookUserTracker.associateWebhookWithUser('webhook123', 'user456');
      const result = webhookUserTracker.getRealUserIdFromWebhook('webhook123');
      expect(result).toBe('user456');
    });

    it('should update timestamp when retrieving association', () => {
      webhookUserTracker.associateWebhookWithUser('webhook123', 'user456');

      // Initial timestamp is 1000000
      // Advance time but not past expiration
      dateNowSpy.mockReturnValue(1500000);

      // Retrieve association - this should update timestamp to 1500000
      const firstResult = webhookUserTracker.getRealUserIdFromWebhook('webhook123');
      expect(firstResult).toBe('user456');

      // Now advance time to just before the original would expire
      // Original timestamp + expiration would be 1000000 + 3600000 = 4600000
      // But since we updated to 1500000, new expiration is 5100000
      dateNowSpy.mockReturnValue(4700000);

      // Run cleanup
      jest.advanceTimersByTime(15 * 60 * 1000);

      // Should still exist because timestamp was updated to 1500000
      const result = webhookUserTracker.getRealUserIdFromWebhook('webhook123');
      expect(result).toBe('user456');
    });
  });

  describe('isProxySystemWebhook', () => {
    it('should return false for null message', () => {
      const result = webhookUserTracker.isProxySystemWebhook(null);
      expect(result).toBe(false);
    });

    it('should return false for non-webhook message', () => {
      const message = { author: { id: '123' } };
      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(false);
    });

    it('should identify PluralKit by application ID', () => {
      const message = {
        webhookId: 'webhook123',
        applicationId: '466378653216014359', // PluralKit ID
        author: { username: 'Test' },
      };

      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Identified proxy system by application ID: 466378653216014359'
      );
    });

    it('should identify Tupperbox by application ID', () => {
      const message = {
        webhookId: 'webhook123',
        applicationId: '510016054391734273', // Tupperbox ID
        author: { username: 'Test' },
      };

      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(true);
    });

    it('should use cached identification', () => {
      const message = {
        webhookId: 'webhook123',
        applicationId: '466378653216014359',
        author: { username: 'Test' },
      };

      // First call
      webhookUserTracker.isProxySystemWebhook(message);
      mockLogger.info.mockClear();
      mockLogger.debug.mockClear();

      // Second call should use cache
      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[WebhookUserTracker] Using cached identification for webhook webhook123'
      );
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should identify by username containing PluralKit', () => {
      const message = {
        webhookId: 'webhook123',
        author: { username: 'Test | PluralKit' },
      };

      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Identified proxy system by name match: Test | PluralKit'
      );
    });

    it('should identify by member nickname containing system name', () => {
      const message = {
        webhookId: 'webhook123',
        author: { username: 'Test' },
        member: { nickname: 'Test | Tupperbox' },
      };

      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(true);
    });

    it('should identify by embed patterns', () => {
      const message = {
        webhookId: 'webhook123',
        author: { username: 'Test' },
        embeds: [
          {
            fields: [
              { name: 'System ID', value: 'abcde' },
              { name: 'Member ID', value: 'fghij' },
            ],
          },
        ],
      };

      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Identified PluralKit by embed patterns'
      );
    });

    it('should identify by pk: pattern in embed values', () => {
      const message = {
        webhookId: 'webhook123',
        author: { username: 'Test' },
        embeds: [
          {
            fields: [{ name: 'Info', value: 'pk:abcde' }],
          },
        ],
      };

      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(true);
    });

    it('should identify by content patterns', () => {
      const message = {
        webhookId: 'webhook123',
        author: { username: 'Test' },
        content: 'Hello! My System ID: abcde',
      };

      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Identified PluralKit by content patterns'
      );
    });

    it('should identify by pk: in content', () => {
      const message = {
        webhookId: 'webhook123',
        author: { username: 'Test' },
        content: 'pk:switch alice',
      };

      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(true);
    });

    it('should return false for non-proxy webhook', () => {
      const message = {
        webhookId: 'webhook123',
        author: { username: 'Regular Webhook' },
        applicationId: '999999999',
      };

      const result = webhookUserTracker.isProxySystemWebhook(message);
      expect(result).toBe(false);
    });
  });

  describe('getRealUserId', () => {
    it('should return null for null message', () => {
      const result = webhookUserTracker.getRealUserId(null);
      expect(result).toBeNull();
    });

    it('should return author ID for non-webhook message', () => {
      const message = { author: { id: '12345' } };
      const result = webhookUserTracker.getRealUserId(message);
      expect(result).toBe('12345');
    });

    it('should return null if no author ID', () => {
      const message = { author: {} };
      const result = webhookUserTracker.getRealUserId(message);
      expect(result).toBeNull();
    });

    it('should return cached user ID for known webhook', () => {
      webhookUserTracker.associateWebhookWithUser('webhook123', 'user456');

      const message = {
        webhookId: 'webhook123',
        author: { id: 'webhook-user' },
      };

      const result = webhookUserTracker.getRealUserId(message);
      expect(result).toBe('user456');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[WebhookUserTracker] Found cached user user456 for webhook webhook123'
      );
    });

    it('should return proxy-system-user for proxy systems', () => {
      const message = {
        webhookId: 'webhook123',
        applicationId: '466378653216014359', // PluralKit
        author: { username: 'Alice', id: 'webhook-user' },
        content: 'Test message',
        channel: { id: 'test-channel-123' },
      };

      const result = webhookUserTracker.getRealUserId(message);
      expect(result).toBe('proxy-system-user');
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Detected proxy system webhook: Alice'
      );
    });

    it('should return author ID for unknown webhook', () => {
      const message = {
        webhookId: 'webhook123',
        author: { id: 'webhook-user' },
      };

      const result = webhookUserTracker.getRealUserId(message);
      expect(result).toBe('webhook-user');
    });
  });

  describe('shouldBypassNsfwVerification', () => {
    it('should return false for null message', () => {
      const result = webhookUserTracker.shouldBypassNsfwVerification(null);
      expect(result).toBe(false);
    });

    it('should return false for non-webhook message', () => {
      const message = { author: { id: '123' } };
      const result = webhookUserTracker.shouldBypassNsfwVerification(message);
      expect(result).toBe(false);
    });

    it('should bypass for proxy system webhooks', () => {
      const message = {
        webhookId: 'webhook123',
        applicationId: '466378653216014359', // PluralKit
        author: { username: 'Alice' },
      };

      const result = webhookUserTracker.shouldBypassNsfwVerification(message);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Bypassing NSFW verification for proxy system: Alice'
      );
    });

    it('should bypass for non-auth webhook commands', () => {
      const message = {
        webhookId: 'webhook123',
        content: `${botPrefix} add personality`,
        author: { username: 'Test' },
      };

      const result = webhookUserTracker.shouldBypassNsfwVerification(message);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Bypassing verification for webhook command: add'
      );
    });

    it('should not bypass for auth command', () => {
      const message = {
        webhookId: 'webhook123',
        content: `${botPrefix} auth start`,
        author: { username: 'Test' },
      };

      const result = webhookUserTracker.shouldBypassNsfwVerification(message);
      expect(result).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "[WebhookUserTracker] Restricted command 'auth' detected from webhook, not bypassing"
      );
    });

    it('should handle commands with no arguments', () => {
      const message = {
        webhookId: 'webhook123',
        content: `${botPrefix}`,
        author: { username: 'Test' },
      };

      const result = webhookUserTracker.shouldBypassNsfwVerification(message);
      expect(result).toBe(true);
    });

    it('should return false for non-command webhook messages', () => {
      const message = {
        webhookId: 'webhook123',
        content: 'Hello world',
        author: { username: 'Test' },
      };

      const result = webhookUserTracker.shouldBypassNsfwVerification(message);
      expect(result).toBe(false);
    });
  });

  describe('isAuthenticationAllowed', () => {
    it('should allow auth for non-webhook messages', () => {
      const message = { author: { id: '123' } };
      const result = webhookUserTracker.isAuthenticationAllowed(message);
      expect(result).toBe(true);
    });

    it('should allow auth for null message', () => {
      const result = webhookUserTracker.isAuthenticationAllowed(null);
      expect(result).toBe(true);
    });

    it('should not allow auth for proxy systems', () => {
      const message = {
        webhookId: 'webhook123',
        applicationId: '466378653216014359', // PluralKit
        author: { username: 'Alice' },
      };

      const result = webhookUserTracker.isAuthenticationAllowed(message);
      expect(result).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Authentication not allowed for proxy system: Alice'
      );
    });

    it('should allow auth for webhook with known user', () => {
      webhookUserTracker.associateWebhookWithUser('webhook123', 'user456');

      const message = {
        webhookId: 'webhook123',
        author: { username: 'Test' },
      };

      const result = webhookUserTracker.isAuthenticationAllowed(message);
      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Authentication allowed for webhook with known user: user456'
      );
    });

    it('should not allow auth for unknown webhook', () => {
      const message = {
        webhookId: 'webhook123',
        author: { username: 'Test' },
      };

      const result = webhookUserTracker.isAuthenticationAllowed(message);
      expect(result).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Authentication not allowed for webhook without known user'
      );
    });
  });

  describe('clearCachedWebhook', () => {
    it('should clear specific cached webhook', () => {
      // First add a webhook to cache
      const message = {
        webhookId: 'webhook123',
        applicationId: '466378653216014359',
        author: { username: 'Test' },
      };
      webhookUserTracker.isProxySystemWebhook(message);

      // Clear it
      webhookUserTracker.clearCachedWebhook('webhook123');
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Cleared cached webhook: webhook123'
      );

      // Verify it's no longer cached
      mockLogger.info.mockClear();
      mockLogger.debug.mockClear();
      webhookUserTracker.isProxySystemWebhook(message);
      expect(mockLogger.debug).not.toHaveBeenCalled(); // Not using cache
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Identified proxy system by application ID: 466378653216014359'
      );
    });

    it('should handle clearing non-existent webhook', () => {
      webhookUserTracker.clearCachedWebhook('nonexistent');
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('clearAllCachedWebhooks', () => {
    it('should clear all cached webhooks', () => {
      // Add multiple webhooks to cache
      const message1 = {
        webhookId: 'webhook1',
        applicationId: '466378653216014359',
        author: { username: 'Test1' },
      };
      const message2 = {
        webhookId: 'webhook2',
        author: { username: 'Test2 | PluralKit' },
      };

      webhookUserTracker.isProxySystemWebhook(message1);
      webhookUserTracker.isProxySystemWebhook(message2);

      // Clear all
      webhookUserTracker.clearAllCachedWebhooks();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Cleared all 2 cached webhooks'
      );

      // Verify they're no longer cached
      mockLogger.info.mockClear();
      mockLogger.debug.mockClear();
      webhookUserTracker.isProxySystemWebhook(message1);
      webhookUserTracker.isProxySystemWebhook(message2);
      expect(mockLogger.debug).not.toHaveBeenCalled(); // Not using cache
    });

    it('should handle clearing when no webhooks cached', () => {
      webhookUserTracker.clearAllCachedWebhooks();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Cleared all 0 cached webhooks'
      );
    });
  });

  describe('cleanup intervals', () => {
    it('should clean up old webhook user associations', () => {
      // Add an association
      webhookUserTracker.associateWebhookWithUser('webhook123', 'user456');

      // Advance time past expiration
      dateNowSpy.mockReturnValue(1000000 + 60 * 60 * 1000 + 1);

      // Manually trigger cleanup since intervals are disabled in tests
      webhookUserTracker.cleanupOldEntries();

      // Verify it's been cleaned up
      const result = webhookUserTracker.getRealUserIdFromWebhook('webhook123');
      expect(result).toBeNull();
    });

    it('should clean up old proxy webhook cache entries', () => {
      // Add to cache
      const message = {
        webhookId: 'webhook123',
        applicationId: '466378653216014359',
        author: { username: 'Test' },
      };
      webhookUserTracker.isProxySystemWebhook(message);

      // Advance time past expiration
      dateNowSpy.mockReturnValue(1000000 + 60 * 60 * 1000 + 1);

      // Manually trigger cleanup since intervals are disabled in tests
      webhookUserTracker.cleanupProxyWebhookCache();

      // Verify cache was cleared by checking if it identifies again
      mockLogger.info.mockClear();
      mockLogger.debug.mockClear();
      webhookUserTracker.isProxySystemWebhook(message);
      expect(mockLogger.debug).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[WebhookUserTracker] Identified proxy system by application ID: 466378653216014359'
      );
    });

    it('should not clean up fresh entries', () => {
      webhookUserTracker.associateWebhookWithUser('webhook123', 'user456');

      // Add proxy cache
      const message = {
        webhookId: 'webhook789',
        applicationId: '466378653216014359',
        author: { username: 'Test' },
      };
      webhookUserTracker.isProxySystemWebhook(message);

      // Advance time but not past expiration
      dateNowSpy.mockReturnValue(1000000 + 30 * 60 * 1000);

      // Manually trigger cleanup since intervals are disabled in tests
      webhookUserTracker.cleanupOldEntries();
      webhookUserTracker.cleanupProxyWebhookCache();

      // Verify entries still exist
      expect(webhookUserTracker.getRealUserIdFromWebhook('webhook123')).toBe('user456');

      mockLogger.debug.mockClear();
      webhookUserTracker.isProxySystemWebhook(message);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[WebhookUserTracker] Using cached identification for webhook webhook789'
      );
    });
  });

  describe('checkProxySystemAuthentication', () => {
    let mockPluralKitStore;
    let mockDDDAuthService;

    beforeEach(() => {
      // Mock the pluralkit message store
      mockPluralKitStore = {
        findByContent: jest.fn(),
        findDeletedMessage: jest.fn(),
      };
      // Make findByContent delegate to findDeletedMessage for backward compatibility
      mockPluralKitStore.findByContent = mockPluralKitStore.findDeletedMessage;
      jest.doMock('../../../src/utils/pluralkitMessageStore', () => ({
        instance: mockPluralKitStore,
      }));

      // Mock DDD authentication service
      mockDDDAuthService = {
        getAuthenticationStatus: jest.fn(),
      };

      // Mock ApplicationBootstrap
      jest.doMock('../../../src/application/bootstrap/ApplicationBootstrap', () => ({
        getApplicationBootstrap: jest.fn(() => ({
          getApplicationServices: jest.fn(() => ({
            authenticationService: mockDDDAuthService,
          })),
        })),
      }));

      // Clear the module cache to ensure fresh mocks
      jest.resetModules();
      webhookUserTracker = require('../../../src/utils/webhookUserTracker');
    });

    it('should return not authenticated for null message', async () => {
      const result = await webhookUserTracker.checkProxySystemAuthentication(null);
      expect(result).toEqual({ isAuthenticated: false, userId: null });
    });

    it('should return not authenticated for non-webhook message', async () => {
      const message = {
        author: { id: 'user123' },
        content: 'Test message',
        channel: { id: 'channel123' },
      };
      const result = await webhookUserTracker.checkProxySystemAuthentication(message);
      expect(result).toEqual({ isAuthenticated: false, userId: null });
    });

    it('should return not authenticated for non-proxy webhook', async () => {
      const message = {
        webhookId: 'webhook123',
        author: { id: 'webhook-user' },
        content: 'Test message',
        channel: { id: 'channel123' },
      };
      const result = await webhookUserTracker.checkProxySystemAuthentication(message);
      expect(result).toEqual({ isAuthenticated: false, userId: null });
    });

    it('should check authentication for proxy system with found message', async () => {
      const message = {
        webhookId: 'webhook123',
        applicationId: '466378653216014359', // PluralKit
        author: { username: 'Alice', id: 'webhook-user' },
        content: 'Test message',
        channel: { id: 'channel123' },
      };

      mockPluralKitStore.findByContent.mockReturnValue({
        userId: 'real-user-123',
        username: 'RealUser',
        channelId: 'channel123',
        content: 'Test message',
      });

      mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({
        isAuthenticated: true,
      });

      const result = await webhookUserTracker.checkProxySystemAuthentication(message);

      expect(mockPluralKitStore.findDeletedMessage).toHaveBeenCalledWith(
        'Test message',
        'channel123'
      );
      expect(mockDDDAuthService.getAuthenticationStatus).toHaveBeenCalledWith('real-user-123');
      expect(result).toEqual({
        isAuthenticated: true,
        userId: 'real-user-123',
        username: 'RealUser',
      });
    });

    it('should return not authenticated when no original message found', async () => {
      const message = {
        webhookId: 'webhook123',
        applicationId: '466378653216014359', // PluralKit
        author: { username: 'Alice', id: 'webhook-user' },
        content: 'Test message',
        channel: { id: 'channel123' },
      };

      mockPluralKitStore.findByContent.mockReturnValue(null);

      const result = await webhookUserTracker.checkProxySystemAuthentication(message);

      expect(mockPluralKitStore.findDeletedMessage).toHaveBeenCalledWith(
        'Test message',
        'channel123'
      );
      expect(result).toEqual({ isAuthenticated: false, userId: null });
    });
  });
});
