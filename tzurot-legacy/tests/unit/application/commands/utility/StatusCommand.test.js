/**
 * Tests for StatusCommand
 */

const {
  createStatusCommand,
  formatUptime,
} = require('../../../../../src/application/commands/utility/StatusCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const logger = require('../../../../../src/logger');
const { getApplicationBootstrap } = require('../../../../../src/application/bootstrap/ApplicationBootstrap');

// Mock logger
jest.mock('../../../../../src/logger');

// Mock ApplicationBootstrap
jest.mock('../../../../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn(),
}));

describe('StatusCommand', () => {
  let statusCommand;
  let mockContext;
  let mockAuth;
  let mockConversationManager;
  let mockProcessUtils;
  let migrationHelper;

  // Helper function to setup authenticated user mocks
  function setupAuthenticatedUser() {
    const mockDDDAuthService = {
      getAuthenticationStatus: jest.fn().mockResolvedValue({
        isAuthenticated: true,
        user: {
          nsfwStatus: {
            verified: true
          }
        }
      })
    };
    getApplicationBootstrap.mockReturnValue({
      initialized: true,
      getApplicationServices: jest.fn().mockReturnValue({
        authenticationService: mockDDDAuthService
      })
    });
    return mockDDDAuthService;
  }

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    migrationHelper = createMigrationHelper();
    
    // Default mock for ApplicationBootstrap - not initialized
    getApplicationBootstrap.mockReturnValue({
      initialized: false,
    });

    // Mock dependencies
    mockAuth = {
      hasValidToken: jest.fn().mockReturnValue(false),
      isNsfwVerified: jest.fn().mockReturnValue(false),
    };

    mockConversationManager = {
      isAutoResponseEnabled: jest.fn().mockReturnValue(false),
      getAllActivatedChannels: jest.fn().mockReturnValue({}),
    };

    mockProcessUtils = {
      uptime: jest.fn().mockReturnValue(3661), // 1 hour, 1 minute, 1 second
    };

    // Create command with mocked dependencies
    statusCommand = createStatusCommand({
      authManager: mockAuth,
      conversationManager: mockConversationManager,
      processUtils: mockProcessUtils,
    });

    // Create mock Discord client
    const mockClient = {
      ws: { ping: 42 },
      guilds: { cache: { size: 5 } },
    };
    
    // Mock context
    mockContext = {
      userId: 'user123',
      channelId: 'channel123',
      guildId: 'guild123',
      commandPrefix: '!tz',
      isDM: false,
      args: [],
      options: {},
      respond: jest.fn().mockResolvedValue(undefined),
      respondWithEmbed: jest.fn().mockResolvedValue(undefined),
      getPing: jest.fn().mockReturnValue(42),
      getGuildCount: jest.fn().mockReturnValue(5),
      getBotName: jest.fn().mockReturnValue('TestBot'),
      // Add Discord message with client
      message: { client: mockClient },
    };
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(statusCommand.name).toBe('status');
      expect(statusCommand.description).toBe('Show bot status information');
      expect(statusCommand.category).toBe('Utility');
      expect(statusCommand.aliases).toEqual([]);
      expect(statusCommand.options).toEqual([]);
    });
  });

  describe('formatUptime', () => {
    it('should format seconds correctly', () => {
      expect(formatUptime(45)).toBe('45 seconds');
      expect(formatUptime(1)).toBe('1 second');
    });

    it('should format minutes correctly', () => {
      expect(formatUptime(60)).toBe('1 minute');
      expect(formatUptime(120)).toBe('2 minutes');
      expect(formatUptime(65)).toBe('1 minute, 5 seconds');
    });

    it('should format hours correctly', () => {
      expect(formatUptime(3600)).toBe('1 hour');
      expect(formatUptime(7200)).toBe('2 hours');
      expect(formatUptime(3665)).toBe('1 hour, 1 minute, 5 seconds');
    });

    it('should format days correctly', () => {
      expect(formatUptime(86400)).toBe('1 day');
      expect(formatUptime(172800)).toBe('2 days');
      expect(formatUptime(90061)).toBe('1 day, 1 hour, 1 minute, 1 second');
    });

    it('should handle zero uptime', () => {
      expect(formatUptime(0)).toBe('');
    });
  });

  describe('execute with embed support', () => {
    it('should show basic status for unauthenticated user', async () => {
      await statusCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Bot Status',
          description: 'Current status and information for TestBot.',
          color: 0x2196f3,
          fields: expect.arrayContaining([
            { name: 'Uptime', value: '1 hour, 1 minute, 1 second', inline: true },
            { name: 'Ping', value: '42ms', inline: true },
            { name: 'Authenticated', value: '❌ No', inline: true },
            { name: 'Age Verified', value: '❌ No', inline: true },
            { name: 'Guild Count', value: '5 servers', inline: true },
            { name: 'Auto-Response', value: '❌ Disabled', inline: true },
          ]),
          footer: {
            text: 'Use "!tz help" for available commands.',
          },
        })
      );
    });

    it('should show additional info for authenticated user', async () => {
      mockAuth.hasValidToken.mockReturnValue(true);
      mockAuth.isNsfwVerified.mockReturnValue(true);
      
      // Setup authenticated user with DDD mocks
      const mockDDDAuthService = setupAuthenticatedUser();
      
      // Mock personality service for personality count
      const mockDDDPersonalityService = {
        listPersonalitiesByOwner: jest.fn().mockResolvedValue(['p1', 'p2', 'p3'])
      };
      
      // Update the mock to include personality service
      getApplicationBootstrap.mockReturnValue({
        initialized: true,
        getApplicationServices: jest.fn().mockReturnValue({
          authenticationService: mockDDDAuthService,
          personalityApplicationService: mockDDDPersonalityService
        })
      });

      await statusCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            { name: 'Authenticated', value: '✅ Yes', inline: true },
            { name: 'Age Verified', value: '✅ Yes', inline: true },
            { name: 'Your Personalities', value: '3 personalities', inline: true },
          ]),
        })
      );
    });

    it('should show active channel personality', async () => {
      mockConversationManager.getAllActivatedChannels.mockReturnValue({
        channel123: 'TestPersonality',
        channel456: 'OtherPersonality',
      });

      await statusCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            { name: 'This Channel', value: '🤖 **TestPersonality** is active', inline: false },
          ]),
        })
      );
    });

    it('should show activated channels count for authenticated users', async () => {
      setupAuthenticatedUser();
      mockAuth.hasValidToken.mockReturnValue(true);
      mockConversationManager.getAllActivatedChannels.mockReturnValue({
        channel123: 'TestPersonality',
        channel456: 'OtherPersonality',
        channel789: 'ThirdPersonality',
      });

      await statusCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            {
              name: 'Activated Channels',
              value: '3 channels have active personalities',
              inline: true,
            },
          ]),
        })
      );
    });

    it('should handle auto-response enabled', async () => {
      mockConversationManager.isAutoResponseEnabled.mockReturnValue(true);

      await statusCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            { name: 'Auto-Response', value: '✅ Enabled', inline: true },
          ]),
        })
      );
    });

    it('should handle missing personality list', async () => {
      setupAuthenticatedUser();
      mockAuth.hasValidToken.mockReturnValue(true);
      // Personality count now comes from DDD service passed in context

      await statusCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            { name: 'Your Personalities', value: 'None added yet', inline: true },
          ]),
        })
      );
    });

    it('should handle single activated channel', async () => {
      setupAuthenticatedUser();
      mockAuth.hasValidToken.mockReturnValue(true);
      mockConversationManager.getAllActivatedChannels.mockReturnValue({
        channel123: 'TestPersonality',
      });

      await statusCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            {
              name: 'Activated Channels',
              value: '1 channel has active personalities',
              inline: true,
            },
          ]),
        })
      );
    });
  });

  describe('execute without embed support', () => {
    beforeEach(() => {
      delete mockContext.respondWithEmbed;
    });

    it('should fall back to text response', async () => {
      await statusCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(expect.stringContaining('**Bot Status**'));
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('Uptime: 1 hour, 1 minute, 1 second')
      );
      expect(mockContext.respond).toHaveBeenCalledWith(expect.stringContaining('Ping: 42ms'));
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('Authenticated: No')
      );
    });

    it('should show authenticated info in text response', async () => {
      mockAuth.hasValidToken.mockReturnValue(true);
      
      // Setup authenticated user and personality service
      const mockDDDAuthService = setupAuthenticatedUser();
      const mockDDDPersonalityService = {
        listPersonalitiesByOwner: jest.fn().mockResolvedValue(['p1', 'p2'])
      };
      
      // Update the mock to include personality service
      getApplicationBootstrap.mockReturnValue({
        initialized: true,
        getApplicationServices: jest.fn().mockReturnValue({
          authenticationService: mockDDDAuthService,
          personalityApplicationService: mockDDDPersonalityService
        })
      });

      await statusCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('Your Personalities: 2')
      );
    });

    it('should show channel activation in text response', async () => {
      mockConversationManager.getAllActivatedChannels.mockReturnValue({
        channel123: 'TestPersonality',
      });

      await statusCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('This Channel: **TestPersonality** is active')
      );
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      // Make the uptime method throw an error to trigger the outer catch
      mockProcessUtils.uptime.mockImplementation(() => {
        throw new Error('Uptime error');
      });

      await statusCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[StatusCommand] Execution failed:',
        expect.any(Error)
      );
      expect(mockContext.respond).toHaveBeenCalledWith(
        'An error occurred while getting bot status.'
      );
    });

    it('should handle missing methods gracefully', async () => {
      delete mockContext.getPing;
      delete mockContext.getGuildCount;
      delete mockContext.getBotName;
      delete mockContext.message; // Remove message with client

      await statusCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Current status and information for the bot.',
          fields: expect.arrayContaining([
            { name: 'Ping', value: 'Calculating...', inline: true },
            { name: 'Guild Count', value: '0 servers', inline: true },
          ]),
        })
      );
    });

    it('should handle missing conversation manager methods', async () => {
      const limitedConversationManager = {};

      const command = createStatusCommand({
        authManager: mockAuth,
        conversationManager: limitedConversationManager,
        processUtils: mockProcessUtils,
      });

      await command.execute(mockContext);

      // Should not throw, should use default values
      expect(mockContext.respondWithEmbed).toHaveBeenCalled();
    });
  });

  describe('factory function', () => {
    it('should create command with default dependencies', () => {
      const command = createStatusCommand();

      expect(command).toBeDefined();
      expect(command.name).toBe('status');
    });

    it('should create command with custom dependencies', () => {
      const customAuth = { hasValidToken: jest.fn() };
      const command = createStatusCommand({ authManager: customAuth });

      expect(command).toBeDefined();
      expect(command.name).toBe('status');
    });
  });
});
