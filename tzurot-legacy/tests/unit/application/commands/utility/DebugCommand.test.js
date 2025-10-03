/**
 * Tests for DebugCommand
 */

const {
  createDebugCommand,
} = require('../../../../../src/application/commands/utility/DebugCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const logger = require('../../../../../src/logger');

// Mock logger
jest.mock('../../../../../src/logger');

// Mock ApplicationBootstrap for clearauth command
jest.mock('../../../../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn(),
}));

const { getApplicationBootstrap } = require('../../../../../src/application/bootstrap/ApplicationBootstrap');

// Note: auth.js no longer exists - authManager is injected via context

describe('DebugCommand', () => {
  let debugCommand;
  let mockContext;
  let mockWebhookUserTracker;
  let mockNsfwVerificationManager;
  let mockConversationManager;
  // Legacy authManager removed - using DDD authentication
  let mockDDDAuthService;
  let mockMessageTracker;
  let migrationHelper;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    migrationHelper = createMigrationHelper();

    // Mock webhook user tracker
    mockWebhookUserTracker = {
      clearAllCachedWebhooks: jest.fn(),
    };

    // Mock NSFW verification manager
    mockNsfwVerificationManager = {
      clearVerification: jest.fn().mockReturnValue(true),
    };

    // Mock conversation manager
    mockConversationManager = {
      clearConversation: jest.fn(),
    };

    // Legacy authManager removed - using DDD authentication
    
    // Mock DDD authentication service
    mockDDDAuthService = {
      revokeAuthentication: jest.fn().mockResolvedValue(),
      cleanupExpiredTokens: jest.fn().mockResolvedValue([]),
    };
    
    // Setup ApplicationBootstrap mock
    getApplicationBootstrap.mockReturnValue({
      getApplicationServices: jest.fn().mockReturnValue({
        authenticationService: mockDDDAuthService
      })
    });

    // Mock message tracker
    mockMessageTracker = {
      clear: jest.fn(),
      size: 42,
    };

    // Create command with mocked dependencies
    debugCommand = createDebugCommand({
      webhookUserTracker: mockWebhookUserTracker,
      nsfwVerificationManager: mockNsfwVerificationManager,
      conversationManager: mockConversationManager,
      messageTracker: mockMessageTracker,
      // Legacy authManager removed - using DDD authentication
    });

    // Mock context
    mockContext = {
      userId: 'user123',
      channelId: 'channel123',
      guildId: 'guild123',
      commandPrefix: '!tz',
      isDM: false,
      isAdmin: true,
      args: [],
      options: {},
      respond: jest.fn().mockResolvedValue(undefined),
      getAuthorDisplayName: jest.fn().mockReturnValue('TestUser#1234'),
    };
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(debugCommand.name).toBe('debug');
      expect(debugCommand.description).toBe(
        'Advanced debugging tools (Requires Administrator permission)'
      );
      expect(debugCommand.category).toBe('Utility');
      expect(debugCommand.aliases).toEqual([]);
      expect(debugCommand.adminOnly).toBe(true);
      expect(debugCommand.options).toHaveLength(1);
    });
  });

  describe('permission check', () => {
    it('should reject non-admin users', async () => {
      mockContext.isAdmin = false;

      await debugCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Access Denied',
            description: 'This command requires administrator permissions or bot owner status.',
            color: 0xf44336,
          }),
        ],
      });
      expect(mockWebhookUserTracker.clearAllCachedWebhooks).not.toHaveBeenCalled();
    });
    
    it('should allow bot owner access even without admin permissions', async () => {
      mockContext.isAdmin = false;
      mockContext.userId = '123456789012345678'; // Default fallback bot owner ID from constants
      
      // Mock the constants module
      jest.doMock('../../../../../src/constants', () => ({
        USER_CONFIG: {
          OWNER_ID: '123456789012345678'
        }
      }));
      
      // Re-create the command with the mocked constants
      debugCommand = createDebugCommand({
        webhookUserTracker: mockWebhookUserTracker,
        nsfwVerificationManager: mockNsfwVerificationManager,
        conversationManager: mockConversationManager,
        // Legacy authManager removed - using DDD authentication
        messageTracker: mockMessageTracker,
      });
      
      await debugCommand.execute(mockContext);
      
      // Should show help instead of access denied
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🛠️ Debug Command Help',
            description: expect.stringContaining('Usage:'),
            color: 0x2196f3,
          }),
        ],
      });
    });
  });

  describe('help display', () => {
    it('should show help when no subcommand provided', async () => {
      await debugCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🛠️ Debug Command Help',
            description: expect.stringContaining('Usage:'),
            color: 0x2196f3,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Available Subcommands',
                value: expect.stringContaining('clearwebhooks'),
              }),
            ]),
          }),
        ],
      });
    });
  });

  describe('clearwebhooks subcommand', () => {
    it('should clear webhook cache', async () => {
      mockContext.args = ['clearwebhooks'];

      await debugCommand.execute(mockContext);

      expect(mockWebhookUserTracker.clearAllCachedWebhooks).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[Debug] Webhook cache cleared by TestUser#1234');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Webhooks Cleared',
            description: 'Cleared all cached webhook identifications.',
            color: 0x4caf50,
          }),
        ],
      });
    });

    it('should work with options instead of args', async () => {
      mockContext.options.subcommand = 'clearwebhooks';

      await debugCommand.execute(mockContext);

      expect(mockWebhookUserTracker.clearAllCachedWebhooks).toHaveBeenCalled();
    });
  });

  describe('unverify subcommand', () => {
    it('should clear NSFW verification when verified', async () => {
      mockContext.args = ['unverify'];

      await debugCommand.execute(mockContext);

      expect(mockNsfwVerificationManager.clearVerification).toHaveBeenCalledWith('user123');
      expect(logger.info).toHaveBeenCalledWith(
        '[Debug] NSFW verification cleared for TestUser#1234'
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Verification Cleared',
            description: 'Your NSFW verification has been cleared. You are now unverified.',
            color: 0x4caf50,
          }),
        ],
      });
    });

    it('should handle when user was not verified', async () => {
      mockNsfwVerificationManager.clearVerification.mockReturnValue(false);
      mockContext.args = ['unverify'];

      await debugCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'ℹ️ No Change',
            description: 'You were not verified, so nothing was cleared.',
            color: 0x2196f3,
          }),
        ],
      });
    });
  });

  describe('clearconversation subcommand', () => {
    it('should clear conversation history', async () => {
      mockContext.args = ['clearconversation'];

      await debugCommand.execute(mockContext);

      expect(mockConversationManager.clearConversation).toHaveBeenCalledWith(
        'user123',
        'channel123'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[Debug] Conversation history cleared for TestUser#1234 in channel channel123'
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Conversation Cleared',
            description: 'Cleared your conversation history in this channel.',
            color: 0x4caf50,
          }),
        ],
      });
    });

    it('should handle conversation clear errors', async () => {
      mockConversationManager.clearConversation.mockImplementation(() => {
        throw new Error('Database error');
      });
      mockContext.args = ['clearconversation'];

      await debugCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[Debug] Error clearing conversation: Database error'
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Clear Failed',
            description: 'Failed to clear conversation history.',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('clearauth subcommand', () => {
    it('should clean up authentication tokens for default user', async () => {
      mockContext.args = ['clearauth']; // Only subcommand, no target user

      await debugCommand.execute(mockContext);

      // Since there's no additional argument after 'clearauth', it should use context.userId
      expect(mockDDDAuthService.revokeAuthentication).toHaveBeenCalledWith('user123');
      expect(mockDDDAuthService.cleanupExpiredTokens).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[Debug] Authentication revocation requested by TestUser#1234 for user user123'
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Authentication Revoked',
          }),
        ],
      });
    });

    it('should clean up authentication tokens for specific user', async () => {
      mockContext.args = ['clearauth', 'target-user-456']; // Subcommand + target user

      await debugCommand.execute(mockContext);

      expect(mockDDDAuthService.revokeAuthentication).toHaveBeenCalledWith('target-user-456');
      expect(mockDDDAuthService.cleanupExpiredTokens).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[Debug] Authentication revocation requested by TestUser#1234 for user target-user-456'
      );
    });

    it('should handle auth cleanup errors', async () => {
      mockDDDAuthService.revokeAuthentication.mockRejectedValue(new Error('Auth error'));
      mockContext.args = ['clearauth'];

      await debugCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith('[Debug] Error clearing auth: Auth error');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Revocation Failed',
            description: 'Failed to revoke authentication: Auth error',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('clearmessages subcommand', () => {
    it('should clear message tracking', async () => {
      mockContext.args = ['clearmessages'];

      await debugCommand.execute(mockContext);

      expect(mockMessageTracker.clear).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[Debug] Message tracking history cleared by TestUser#1234'
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Messages Cleared',
            description: 'Cleared message tracking history.',
            color: 0x4caf50,
          }),
        ],
      });
    });

    it('should handle message tracker errors', async () => {
      mockMessageTracker.clear.mockImplementation(() => {
        throw new Error('Tracker error');
      });
      mockContext.args = ['clearmessages'];

      await debugCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[Debug] Error clearing message tracker: Tracker error'
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Clear Failed',
            description: 'Failed to clear message tracking.',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('stats subcommand', () => {
    it('should show debug statistics', async () => {
      mockContext.args = ['stats'];

      await debugCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '📊 Debug Statistics',
            description: 'Current system debug information',
            color: 0x2196f3,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Messages',
                value: 'Tracked: 42',
              }),
              expect.objectContaining({
                name: 'Raw Data',
                value: expect.stringContaining('"tracked": 42'),
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle stats gathering errors', async () => {
      // Make messageTracker.size throw on access
      Object.defineProperty(mockMessageTracker, 'size', {
        get: () => {
          throw new Error('Property access error');
        },
      });
      mockContext.args = ['stats'];

      await debugCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[Debug] Error gathering stats: Property access error'
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Stats Failed',
            description: 'Failed to gather statistics.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle missing size property', async () => {
      delete mockMessageTracker.size;
      mockContext.args = ['stats'];

      await debugCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '📊 Debug Statistics',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Raw Data',
                value: expect.stringContaining('"tracked": 0'),
              }),
            ]),
          }),
        ],
      });
    });
  });

  describe('invalid subcommand', () => {
    it('should show error for unknown subcommand', async () => {
      mockContext.args = ['invalid'];

      await debugCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Unknown Subcommand',
            description: 'Unknown debug subcommand: `invalid`.',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('personality subcommand', () => {
    let mockPersonalityApplicationService;
    let mockPersonality;

    beforeEach(() => {
      // Create mock personality with full structure
      mockPersonality = {
        personalityId: { toString: () => 'test-personality' },
        profile: {
          mode: 'external',
          errorMessage: '*sighs* Something went wrong!',
          constructor: { name: 'PersonalityProfile' },
          prompt: null,
          modelPath: null,
        },
      };

      // Mock personality router
      mockPersonalityApplicationService = {
        getPersonality: jest.fn().mockResolvedValue(mockPersonality),
      };

      // Update ApplicationBootstrap mock to include PersonalityApplicationService
      getApplicationBootstrap.mockReturnValue({
        getApplicationServices: jest.fn().mockReturnValue({
          authenticationService: mockDDDAuthService,
        }),
        getPersonalityApplicationService: jest.fn().mockReturnValue(mockPersonalityApplicationService),
      });
    });

    it('should check personality and show debug info', async () => {
      mockContext.args = ['personality', 'test-personality'];

      await debugCommand.execute(mockContext);

      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('test-personality');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🔍 Personality Debug Info',
            description: 'Debug information for **test-personality**',
            color: 0x4caf50,
            fields: expect.arrayContaining([
              { name: 'Full Name', value: 'test-personality', inline: true },
              { name: 'Profile Mode', value: 'external', inline: true },
              { name: 'Has Profile', value: 'Yes', inline: true },
              { name: 'Has Error Message', value: 'Yes', inline: true },
              { name: 'Profile Type', value: 'PersonalityProfile', inline: true },
              { name: 'Has Prompt', value: 'Not set', inline: true },
              { name: 'Model Path', value: 'Not set', inline: true },
              {
                name: 'Error Message',
                value: '```*sighs* Something went wrong!```',
                inline: false,
              },
            ]),
          }),
        ],
      });
    });

    it('should show error when personality name is missing', async () => {
      mockContext.args = ['personality']; // Missing personality name

      await debugCommand.execute(mockContext);

      expect(mockPersonalityApplicationService.getPersonality).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Missing Personality Name',
            description: 'Usage: `!tz debug personality <name>`',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle personality not found', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);
      mockContext.args = ['personality', 'nonexistent'];

      await debugCommand.execute(mockContext);

      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('nonexistent');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Personality Not Found',
            description: 'No personality found with name: `nonexistent`',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle personality without error message', async () => {
      mockPersonality.profile.errorMessage = null;
      mockContext.args = ['personality', 'test-personality'];

      await debugCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              { name: 'Has Error Message', value: 'No', inline: true },
              { name: 'Error Message', value: '```Not set```', inline: false },
            ]),
          }),
        ],
      });
    });

    it('should handle personality without profile', async () => {
      mockPersonality.profile = null;
      mockContext.args = ['personality', 'test-personality'];

      await debugCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              { name: 'Has Profile', value: 'No', inline: true },
              { name: 'Profile Mode', value: 'N/A', inline: true },
              { name: 'Has Error Message', value: 'No', inline: true },
              { name: 'Profile Type', value: 'None', inline: true },
              { name: 'Error Message', value: '```Not set```', inline: false },
            ]),
          }),
        ],
      });
    });

    it('should handle local personality with prompt', async () => {
      mockPersonality.profile = {
        mode: 'local',
        errorMessage: 'Oops, something broke!',
        prompt: 'You are a test personality',
        modelPath: '/custom-model',
        constructor: { name: 'PersonalityProfile' },
      };
      mockContext.args = ['personality', 'local-personality'];

      await debugCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              { name: 'Profile Mode', value: 'local', inline: true },
              { name: 'Has Prompt', value: 'Set', inline: true },
              { name: 'Model Path', value: '/custom-model', inline: true },
              { name: 'Error Message', value: '```Oops, something broke!```', inline: false },
            ]),
          }),
        ],
      });
    });

    it('should handle errors when checking personality', async () => {
      mockPersonalityApplicationService.getPersonality.mockRejectedValue(new Error('Database error'));
      mockContext.args = ['personality', 'test-personality'];

      await debugCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[Debug] Error checking personality: Database error'
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Check Failed',
            description: 'Failed to check personality: Database error',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      // Create a scenario that causes an error
      const errorCommand = createDebugCommand({
        webhookUserTracker: null, // Will cause error when accessed
      });

      mockContext.args = ['clearwebhooks'];
      await errorCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[DebugCommand] Execution failed:',
        expect.any(Error)
      );
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Command Error',
            description: 'An error occurred while executing the debug command.',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('factory function', () => {
    it('should create command with default dependencies', () => {
      const command = createDebugCommand();

      expect(command).toBeDefined();
      expect(command.name).toBe('debug');
      expect(command.adminOnly).toBe(true);
    });

    it('should create command with custom dependencies', () => {
      const customTracker = { clear: jest.fn() };
      const command = createDebugCommand({
        messageTracker: customTracker,
      });

      expect(command).toBeDefined();
      expect(command.name).toBe('debug');
    });
  });
});
