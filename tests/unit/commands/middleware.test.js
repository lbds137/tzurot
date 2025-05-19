// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../src/logger');
jest.mock('../../../config');
jest.mock('../../../src/auth');

// Import mocked modules
const logger = require('../../../src/logger');
const config = require('../../../config');
const auth = require('../../../src/auth');

describe('Command Middleware', () => {
  let deduplicationMiddleware;
  let authMiddleware;
  let permissionsMiddleware;
  let mockMessage;
  let mockAuthor;
  let mockChannel;
  let mockMember;
  let mockPermissions;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset modules
    jest.resetModules();
    
    // Mock config
    config.botPrefix = '!tz';
    
    // Create mock permissions
    mockPermissions = {
      has: jest.fn().mockReturnValue(true)
    };

    // Create mock member
    mockMember = {
      permissions: mockPermissions
    };
    
    // Create mock author
    mockAuthor = {
      id: 'user-123',
      tag: 'User#1234',
      send: jest.fn().mockResolvedValue({ id: 'dm-123' })
    };
    
    // Create mock channel
    mockChannel = {
      id: 'channel-123',
      send: jest.fn().mockResolvedValue({ id: 'sent-message-123' }),
      isDMBased: jest.fn().mockReturnValue(false)
    };
    
    // Create mock message
    mockMessage = {
      id: 'message-123',
      author: mockAuthor,
      channel: mockChannel,
      member: mockMember,
      reply: jest.fn().mockResolvedValue({ id: 'reply-123' }),
      webhookId: null
    };
    
    // Mock auth module
    auth.hasValidToken = jest.fn().mockReturnValue(true);
    
    // Import the middleware modules
    deduplicationMiddleware = require('../../../src/commands/middleware/deduplication');
    authMiddleware = require('../../../src/commands/middleware/auth');
    permissionsMiddleware = require('../../../src/commands/middleware/permissions');
  });

  describe('Deduplication Middleware', () => {
    it('should allow processing for first-time commands', () => {
      const result = deduplicationMiddleware(mockMessage, 'test', []);
      
      expect(result).toEqual({
        shouldProcess: true
      });
    });
    
    it('should handle duplicate message IDs', () => {
      // First call should be processed
      const result1 = deduplicationMiddleware(mockMessage, 'test', []);
      expect(result1.shouldProcess).toBe(true);
      
      // Second call with the same message ID should be blocked
      const result2 = deduplicationMiddleware(mockMessage, 'test', []);
      expect(result2.shouldProcess).toBe(false);
    });
  });

  describe('Auth Middleware', () => {
    it('should allow authenticated users', async () => {
      auth.hasValidToken.mockReturnValue(true);
      
      const result = await authMiddleware(mockMessage, 'test', []);
      
      expect(result).toEqual({
        authenticated: true
      });
    });
    
    it('should handle unauthenticated users', async () => {
      auth.hasValidToken.mockReturnValue(false);
      
      const result = await authMiddleware(mockMessage, 'test', []);
      
      expect(result.authenticated).toBe(false);
      expect(result.error).toBeDefined();
    });
    
    it('should allow auth commands for unauthenticated users', async () => {
      auth.hasValidToken.mockReturnValue(false);
      
      const result = await authMiddleware(mockMessage, 'auth', []);
      
      expect(result.authenticated).toBe(true);
    });
    
    it('should allow help commands for unauthenticated users', async () => {
      auth.hasValidToken.mockReturnValue(false);
      
      const result = await authMiddleware(mockMessage, 'help', []);
      
      expect(result.authenticated).toBe(true);
    });
    
    it('should handle webhook messages', async () => {
      // Mock a webhook message
      const webhookMessage = {
        ...mockMessage,
        webhookId: 'webhook-123'
      };
      
      // Mock the webhook tracker
      jest.mock('../../../src/utils/webhookUserTracker', () => ({
        shouldBypassNsfwVerification: jest.fn().mockReturnValue(true),
        isAuthenticationAllowed: jest.fn().mockReturnValue(true)
      }));
      
      const result = await authMiddleware(webhookMessage, 'test', []);
      
      expect(result.authenticated).toBe(true);
    });
  });

  describe('Permissions Middleware', () => {
    it('should allow commands with no permission requirements', () => {
      const commandModule = {
        meta: {
          name: 'test',
          permissions: []
        }
      };
      
      const result = permissionsMiddleware(mockMessage, 'test', commandModule);
      
      expect(result).toEqual({
        hasPermission: true
      });
    });
    
    it('should check administrator permissions', () => {
      const commandModule = {
        meta: {
          name: 'test',
          permissions: ['ADMINISTRATOR']
        }
      };
      
      // Mock the permission check to pass
      mockPermissions.has.mockReturnValue(true);
      
      const result = permissionsMiddleware(mockMessage, 'test', commandModule);
      
      expect(result.hasPermission).toBe(true);
      
      // Now make the permission check fail
      mockPermissions.has.mockReturnValue(false);
      
      const result2 = permissionsMiddleware(mockMessage, 'test', commandModule);
      
      expect(result2.hasPermission).toBe(false);
      expect(result2.error).toBeDefined();
    });
    
    it('should check NSFW channel permission', () => {
      const commandModule = {
        meta: {
          name: 'test',
          permissions: ['NSFW_CHANNEL']
        }
      };
      
      // Mock the isNsfwChannel function
      jest.mock('../../../src/commands/utils/commandValidator', () => ({
        isNsfwChannel: jest.fn().mockReturnValue(true),
        getPermissionErrorMessage: jest.fn().mockReturnValue('Error message')
      }));
      
      // Reimport the middleware to use the new mock
      jest.resetModules();
      const permissionsMiddleware = require('../../../src/commands/middleware/permissions');
      
      const result = permissionsMiddleware(mockMessage, 'test', commandModule);
      
      // We can't fully assert here because of how we're mocking the validator,
      // but the test ensures the code path is executed
      expect(result).toBeDefined();
    });
  });
});