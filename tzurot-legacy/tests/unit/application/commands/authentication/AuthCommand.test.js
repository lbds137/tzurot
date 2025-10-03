/**
 * Tests for AuthCommand
 */

const {
  createAuthCommand,
} = require('../../../../../src/application/commands/authentication/AuthCommand');

// Mock logger
jest.mock('../../../../../src/logger');

// Mock ApplicationBootstrap
jest.mock('../../../../../src/application/bootstrap/ApplicationBootstrap');

const { getApplicationBootstrap } = require('../../../../../src/application/bootstrap/ApplicationBootstrap');

describe('AuthCommand', () => {
  let authCommand;
  let mockContext;
  let mockAuth;
  let mockWebhookUserTracker;
  let mockDDDAuthService;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Mock DDD authentication service
    mockDDDAuthService = {
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://auth.example.com/authorize'),
      exchangeCodeForToken: jest.fn().mockResolvedValue({ token: 'test-token', user: {} }),
      getAuthenticationStatus: jest.fn().mockResolvedValue({ isAuthenticated: false }),
      revokeAuthentication: jest.fn().mockResolvedValue(),
      cleanupExpiredTokens: jest.fn().mockResolvedValue([]),
    };

    // Mock ApplicationBootstrap
    getApplicationBootstrap.mockReturnValue({
      getApplicationServices: jest.fn().mockReturnValue({
        authenticationService: mockDDDAuthService,
      }),
    });

    authCommand = createAuthCommand();

    // Mock auth service (legacy - still passed in dependencies but not used)
    mockAuth = {
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://auth.example.com/authorize'),
      getTokenFromCode: jest.fn().mockResolvedValue('test-token'),
      storeUserToken: jest.fn().mockResolvedValue(true),
      hasValidToken: jest.fn().mockReturnValue(false),
      getTokenAge: jest.fn().mockReturnValue(null),
      getTokenExpirationInfo: jest.fn().mockReturnValue(null),
      deleteUserToken: jest.fn().mockResolvedValue(true),
      cleanupExpiredTokens: jest.fn().mockResolvedValue(0),
    };

    // Mock webhook user tracker
    mockWebhookUserTracker = {
      isProxySystemWebhook: jest.fn().mockReturnValue(false),
    };

    // Mock context
    mockContext = {
      userId: 'user123',
      channelId: 'channel123',
      guildId: 'guild123',
      commandPrefix: '!tz',
      isDM: jest.fn().mockReturnValue(false),
      isWebhook: false,
      args: [],
      options: {},
      dependencies: {
        auth: mockAuth,
        webhookUserTracker: mockWebhookUserTracker,
      },
      respond: jest.fn().mockResolvedValue(undefined),
      sendDM: jest.fn().mockResolvedValue(undefined),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
      startTyping: jest.fn().mockResolvedValue(undefined),
      hasPermission: jest.fn().mockResolvedValue(false),
      originalMessage: {
        webhookId: null,
      },
    };
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(authCommand.name).toBe('auth');
      expect(authCommand.description).toBe('Authenticate with the AI service');
      expect(authCommand.category).toBe('Authentication');
      expect(authCommand.aliases).toEqual([]);
      expect(authCommand.options).toHaveLength(2);
    });
  });

  describe('help display', () => {
    it('should show help when no action is provided', async () => {
      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🔐 Authentication Help',
            description: expect.stringContaining('To get started'),
            color: 0x2196f3,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Available Commands',
                value: expect.stringContaining('auth start'),
              }),
            ]),
          }),
        ],
      });
    });

    it('should show admin commands for administrators', async () => {
      mockContext.hasPermission.mockResolvedValue(true);

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: '👨‍💼 Admin Commands',
                value: expect.stringContaining('auth cleanup'),
              }),
            ]),
          }),
        ],
      });
    });

    it('should show admin commands for bot owner', async () => {
      process.env.BOT_OWNER_ID = 'user123';

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: '👨‍💼 Admin Commands',
              }),
            ]),
          }),
        ],
      });
    });
  });

  describe('proxy system handling', () => {
    it('should reject webhook commands from proxy systems', async () => {
      mockContext.isWebhook = true;
      mockContext.originalMessage.webhookId = 'webhook123';
      mockWebhookUserTracker.isProxySystemWebhook.mockReturnValue(true);

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Authentication with Proxy Systems',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('auth start', () => {
    it('should send auth URL in DM when in DM channel', async () => {
      mockContext.isDM.mockReturnValue(true);
      mockContext.args = ['start'];

      await authCommand.execute(mockContext);

      expect(mockDDDAuthService.getAuthorizationUrl).toHaveBeenCalledWith('user123');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🔐 Authentication Required',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: '1️⃣ Click the link',
                value: expect.stringContaining('https://auth.example.com/authorize'),
              }),
            ]),
          }),
        ],
      });
      expect(mockContext.sendDM).not.toHaveBeenCalled();
    });

    it('should send DM when in public channel', async () => {
      mockContext.args = ['start'];

      await authCommand.execute(mockContext);

      expect(mockDDDAuthService.getAuthorizationUrl).toHaveBeenCalledWith('user123');
      expect(mockContext.sendDM).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🔐 Authentication Required',
            fields: expect.arrayContaining([
              expect.objectContaining({
                value: expect.stringContaining('https://auth.example.com/authorize'),
              }),
            ]),
          }),
        ],
      });
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '📨 Check Your DMs',
          }),
        ],
      });
    });

    it('should handle DM failure gracefully', async () => {
      mockContext.args = ['start'];
      mockContext.sendDM.mockRejectedValue(new Error('DMs disabled'));

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Unable to Send DM',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle auth URL generation failure', async () => {
      mockContext.args = ['start'];
      mockDDDAuthService.getAuthorizationUrl.mockResolvedValue(null);

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Authentication Failed',
            description: 'Failed to generate authentication URL.',
          }),
        ],
      });
    });
  });

  describe('auth code', () => {
    it('should reject code submission in public channels', async () => {
      mockContext.args = ['code', 'test-code'];

      await authCommand.execute(mockContext);

      expect(mockContext.deleteMessage).toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🔒 Security Warning',
            description: 'For security, authorization codes must be submitted via DM only.',
            color: 0xff9800,
          }),
        ],
      });
    });

    it('should process code in DM channel', async () => {
      mockContext.isDM.mockReturnValue(true);
      mockContext.args = ['code', 'test-code'];

      await authCommand.execute(mockContext);

      // Note: startTyping is not available in DDD command context
      expect(mockDDDAuthService.exchangeCodeForToken).toHaveBeenCalledWith('user123', 'test-code');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Authorization Successful!',
            description: 'Your account has been successfully linked.',
            color: 0x4caf50,
          }),
        ],
      });
    });

    it('should handle spoiler-wrapped codes', async () => {
      mockContext.isDM.mockReturnValue(true);
      mockContext.args = ['code', '||test-code||'];

      await authCommand.execute(mockContext);

      expect(mockDDDAuthService.exchangeCodeForToken).toHaveBeenCalledWith('user123', 'test-code');
    });

    it('should handle missing code', async () => {
      mockContext.args = ['code'];

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Code Required',
            description: 'Please provide your authorization code.',
          }),
        ],
      });
    });

    it('should handle invalid code', async () => {
      mockContext.isDM.mockReturnValue(true);
      mockContext.args = ['code', 'invalid-code'];
      mockDDDAuthService.exchangeCodeForToken.mockRejectedValue(new Error('Invalid code'));

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Authorization Failed',
            description: 'Unable to validate your authorization code.',
          }),
        ],
      });
    });

    // Token storage is now handled by DDD service during exchange
    // The storage failure test is no longer needed as failures are caught in exchangeCodeForToken
  });

  describe('auth status', () => {
    it('should show status when not authenticated', async () => {
      mockContext.args = ['status'];
      mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({ isAuthenticated: false });

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Not Authorized',
            description: "You don't have an active authorization token.",
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should show status when authenticated', async () => {
      mockContext.args = ['status'];
      mockDDDAuthService.getAuthenticationStatus.mockResolvedValue({ 
        isAuthenticated: true
      });

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🔐 Authentication Status',
            description: expect.stringContaining('Your authorization is active'),
            color: 0x4caf50,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Status',
                value: '✅ Authorized',
              }),
            ]),
          }),
        ],
      });
    });

    // Token expiration is no longer part of the DDD authentication system

    // Token expiration warnings are no longer needed in DDD system
  });

  describe('auth revoke', () => {
    it('should revoke token successfully', async () => {
      mockContext.args = ['revoke'];

      await authCommand.execute(mockContext);

      expect(mockDDDAuthService.revokeAuthentication).toHaveBeenCalledWith('user123');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Authorization Revoked',
            description: 'Your authorization has been successfully revoked.',
            color: 0x4caf50,
          }),
        ],
      });
    });

    it('should handle revoke failure', async () => {
      mockContext.args = ['revoke'];
      mockDDDAuthService.revokeAuthentication.mockRejectedValue(new Error('Revocation failed'));

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Revocation Failed',
            description: 'Unable to revoke your authorization.',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('auth cleanup', () => {
    it('should require admin permission', async () => {
      mockContext.args = ['cleanup'];
      mockContext.hasPermission.mockResolvedValue(false);
      process.env.BOT_OWNER_ID = 'other-user'; // Make sure user is not bot owner

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Permission Denied',
            description: 'This command requires administrator permissions.',
          }),
        ],
      });
      expect(mockDDDAuthService.cleanupExpiredTokens).not.toHaveBeenCalled();
    });

    it('should allow cleanup for administrators', async () => {
      mockContext.args = ['cleanup'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockDDDAuthService.cleanupExpiredTokens.mockResolvedValue(['user1', 'user2', 'user3']);

      await authCommand.execute(mockContext);

      expect(mockDDDAuthService.cleanupExpiredTokens).toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Cleanup Complete',
            description: 'Successfully removed 3 expired tokens.',
          }),
        ],
      });
    });

    it('should allow cleanup for bot owner', async () => {
      process.env.BOT_OWNER_ID = 'user123';
      mockContext.args = ['cleanup'];
      mockDDDAuthService.cleanupExpiredTokens.mockResolvedValue([]);

      await authCommand.execute(mockContext);

      expect(mockDDDAuthService.cleanupExpiredTokens).toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Cleanup Complete',
            description: 'No expired tokens were found.',
          }),
        ],
      });
    });

    it('should handle cleanup errors', async () => {
      mockContext.args = ['cleanup'];
      mockContext.hasPermission.mockResolvedValue(true);
      mockDDDAuthService.cleanupExpiredTokens.mockRejectedValue(new Error('Database error'));

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Cleanup Failed',
            description: 'An error occurred during the cleanup process.',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Error details',
                value: 'Database error',
              }),
            ]),
          }),
        ],
      });
    });
  });

  describe('error handling', () => {
    it('should handle unknown subcommands', async () => {
      mockContext.args = ['unknown'];

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Unknown Auth Command',
            description: '"unknown" is not a valid auth subcommand.',
          }),
        ],
      });
    });

    it('should handle unexpected errors', async () => {
      mockContext.args = ['start'];
      mockDDDAuthService.getAuthorizationUrl.mockRejectedValue(new Error('Network error'));

      await authCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Authentication Error',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Error details',
                value: 'Network error',
              }),
            ]),
          }),
        ],
      });
    });
  });

  describe('options support', () => {
    it('should support action option for slash commands', async () => {
      mockContext.options = { action: 'status' };

      await authCommand.execute(mockContext);

      expect(mockDDDAuthService.getAuthenticationStatus).toHaveBeenCalled();
    });

    it('should support code option for slash commands', async () => {
      mockContext.isDM.mockReturnValue(true);
      mockContext.options = { action: 'code', code: 'test-code' };

      await authCommand.execute(mockContext);

      expect(mockDDDAuthService.exchangeCodeForToken).toHaveBeenCalledWith('user123', 'test-code');
    });
  });
});
