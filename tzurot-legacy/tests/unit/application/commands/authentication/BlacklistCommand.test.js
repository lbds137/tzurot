/**
 * Tests for BlacklistCommand
 * @jest-environment node
 * @testType unit
 */

const {
  createBlacklistCommand,
} = require('../../../../../src/application/commands/authentication/BlacklistCommand');
const logger = require('../../../../../src/logger');

// Mock logger
jest.mock('../../../../../src/logger');

// Mock ApplicationBootstrap
jest.mock('../../../../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn(() => ({
    getApplicationServices: jest.fn(() => ({
      authenticationService: mockAuthService,
    })),
    getBlacklistService: jest.fn(() => mockBlacklistService),
  })),
}));

// Create mock services that will be referenced by the mock
let mockAuthService;
let mockBlacklistService;

describe('BlacklistCommand', () => {
  let blacklistCommand;
  let mockContext;
  let mockRespond;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    // Reset auth service mock
    mockAuthService = {
      getAuthenticationStatus: jest.fn(),
      blacklistUser: jest.fn(),
      unblacklistUser: jest.fn(), 
      getBlacklistedUsers: jest.fn(),
    };

    // Reset blacklist service mock
    mockBlacklistService = {
      isUserBlacklisted: jest.fn(),
      blacklistUser: jest.fn(),
      unblacklistUser: jest.fn(),
      getBlacklistedUsers: jest.fn(),
      getBlacklistDetails: jest.fn(),
    };

    blacklistCommand = createBlacklistCommand();

    // Mock respond function
    mockRespond = jest.fn().mockResolvedValue(undefined);

    // Mock context
    mockContext = {
      userId: '123456789012345678', // Admin user
      channelId: 'channel123',
      guildId: 'guild123',
      commandPrefix: '!tz',
      hasPermission: jest.fn().mockResolvedValue(true), // Has admin permission by default
      respond: mockRespond,
      args: [],
      options: {},
      dependencies: {},
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Command Properties', () => {
    it('should have correct metadata', () => {
      expect(blacklistCommand.name).toBe('blacklist');
      expect(blacklistCommand.description).toBe('Globally blacklist or unblacklist users from using the bot');
      expect(blacklistCommand.category).toBe('Authentication');
      expect(blacklistCommand.aliases).toEqual(['bl']);
    });

    it('should have correct options', () => {
      expect(blacklistCommand.options).toHaveLength(3);
      
      const actionOption = blacklistCommand.options[0];
      expect(actionOption.name).toBe('action');
      expect(actionOption.required).toBe(true);
      expect(actionOption.choices).toHaveLength(4);
      expect(actionOption.choices.map(c => c.value)).toEqual(['add', 'remove', 'list', 'check']);

      const userOption = blacklistCommand.options[1];
      expect(userOption.name).toBe('user');
      expect(userOption.type).toBe('user');
      expect(userOption.required).toBe(false);

      const reasonOption = blacklistCommand.options[2];
      expect(reasonOption.name).toBe('reason');
      expect(reasonOption.type).toBe('string');
      expect(reasonOption.required).toBe(false);
    });
  });

  describe('Permission Checks', () => {
    it('should deny access to non-admin users', async () => {
      mockContext.hasPermission.mockResolvedValue(false);
      mockContext.userId = '987654321098765432'; // Not bot owner

      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Permission Denied',
            description: 'This command requires administrator permissions.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should allow access to admin users', async () => {
      mockContext.hasPermission.mockResolvedValue(true);
      mockContext.args = ['list'];
      mockBlacklistService.getBlacklistedUsers.mockResolvedValue([]);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.getBlacklistedUsers).toHaveBeenCalled();
    });

    it('should allow access to bot owner even without admin permission', async () => {
      mockContext.hasPermission.mockResolvedValue(false);
      mockContext.userId = process.env.BOT_OWNER_ID;
      mockContext.args = ['list'];
      mockBlacklistService.getBlacklistedUsers.mockResolvedValue([]);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.getBlacklistedUsers).toHaveBeenCalled();
    });
  });

  describe('Help Display', () => {
    it('should show help when no action is provided', async () => {
      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🚫 Global Blacklist Management',
            description: 'Manage global user blacklist - blocks ALL bot interactions',
            color: 0x2196f3,
          }),
        ],
      });
    });

    it('should show error for unknown action', async () => {
      mockContext.args = ['invalid'];

      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Unknown Blacklist Command',
            description: '"invalid" is not a valid blacklist subcommand.',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('Add Subcommand', () => {
    beforeEach(() => {
      mockContext.args = ['add'];
    });

    it('should blacklist user with reason using options', async () => {
      mockContext.options = {
        action: 'add',
        user: { id: '111111111111111111' },
        reason: 'Spamming the bot',
      };
      mockBlacklistService.isUserBlacklisted.mockResolvedValue(false);
      mockBlacklistService.blacklistUser.mockResolvedValue(undefined);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.isUserBlacklisted).toHaveBeenCalledWith('111111111111111111');
      expect(mockBlacklistService.blacklistUser).toHaveBeenCalledWith('111111111111111111', 'Spamming the bot', mockContext.userId);
      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ User Blacklisted',
            description: 'Successfully blacklisted <@111111111111111111>',
            color: 0x4caf50,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Reason',
                value: 'Spamming the bot',
              }),
            ]),
          }),
        ],
      });
    });

    it('should blacklist user with reason using args', async () => {
      mockContext.args = ['add', '<@111111111111111111>', 'Spamming', 'the', 'bot'];
      mockBlacklistService.isUserBlacklisted.mockResolvedValue(false);
      mockBlacklistService.blacklistUser.mockResolvedValue(undefined);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.blacklistUser).toHaveBeenCalledWith('111111111111111111', 'Spamming the bot', mockContext.userId);
    });

    it('should blacklist user with default reason when not provided', async () => {
      mockContext.args = ['add', '111111111111111111'];
      mockBlacklistService.isUserBlacklisted.mockResolvedValue(false);
      mockBlacklistService.blacklistUser.mockResolvedValue(undefined);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.blacklistUser).toHaveBeenCalledWith('111111111111111111', 'No reason provided', mockContext.userId);
    });

    it('should show error when user is missing', async () => {
      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ User Required',
            description: 'Please specify a user to blacklist.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should show warning when user is already blacklisted', async () => {
      mockContext.args = ['add', '111111111111111111'];
      mockBlacklistService.isUserBlacklisted.mockResolvedValue(true);
      mockBlacklistService.getBlacklistDetails.mockResolvedValue({
        userId: { toString: () => '111111111111111111' },
        reason: 'Previous spam',
        blacklistedBy: { toString: () => '987654321' },
        blacklistedAt: new Date('2024-01-01'),
      });

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.blacklistUser).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '⚠️ Already Blacklisted',
            description: 'User <@111111111111111111> is already blacklisted.',
            color: 0xff9800,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Current Reason',
                value: 'Previous spam',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle blacklist errors', async () => {
      mockContext.args = ['add', '111111111111111111', 'Test reason'];
      mockBlacklistService.isUserBlacklisted.mockResolvedValue(false);
      mockBlacklistService.blacklistUser.mockRejectedValue(new Error('Database error'));

      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Blacklist Failed',
            description: 'Unable to blacklist the user.',
            color: 0xf44336,
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

  describe('Remove Subcommand', () => {
    beforeEach(() => {
      mockContext.args = ['remove'];
    });

    it('should unblacklist user using options', async () => {
      mockContext.options = {
        action: 'remove',
        user: { id: '111111111111111111' },
      };
      mockBlacklistService.getBlacklistDetails.mockResolvedValue({
        userId: { toString: () => '111111111111111111' },
        reason: 'Old spam',
        blacklistedBy: { toString: () => '987654321' },
        blacklistedAt: new Date('2024-01-01'),
      });
      mockBlacklistService.unblacklistUser.mockResolvedValue(undefined);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.getBlacklistDetails).toHaveBeenCalledWith('111111111111111111');
      expect(mockBlacklistService.unblacklistUser).toHaveBeenCalledWith('111111111111111111', mockContext.userId);
      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ User Unblacklisted',
            description: 'Successfully removed <@111111111111111111> from blacklist',
            color: 0x4caf50,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Previous Reason',
                value: 'Old spam',
              }),
            ]),
          }),
        ],
      });
    });

    it('should unblacklist user using args with mention', async () => {
      mockContext.args = ['remove', '<@!111111111111111111>'];
      mockBlacklistService.isUserBlacklisted.mockResolvedValue(true);
      mockBlacklistService.getBlacklistDetails.mockResolvedValue({
        userId: { toString: () => '111111111111111111' },
        reason: 'Test',
        blacklistedBy: { toString: () => '987654321' },
        blacklistedAt: new Date('2024-01-01'),
      });
      mockBlacklistService.unblacklistUser.mockResolvedValue(undefined);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.unblacklistUser).toHaveBeenCalledWith('111111111111111111', mockContext.userId);
    });

    it('should show error when user is missing', async () => {
      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ User Required',
            description: 'Please specify a user to unblacklist.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should show warning when user is not blacklisted', async () => {
      mockContext.args = ['remove', '111111111111111111'];
      mockBlacklistService.isUserBlacklisted.mockResolvedValue(false);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.unblacklistUser).not.toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '⚠️ Not Blacklisted',
            description: 'User <@111111111111111111> is not currently blacklisted.',
            color: 0xff9800,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Current Status',
                value: '✅ Can use bot normally',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle unblacklist errors', async () => {
      mockContext.args = ['remove', '111111111111111111'];
      mockBlacklistService.isUserBlacklisted.mockResolvedValue(true);
      mockBlacklistService.getBlacklistDetails.mockResolvedValue({
        userId: { toString: () => '111111111111111111' },
        reason: 'Old reason',
        blacklistedBy: { toString: () => '987654321' },
        blacklistedAt: new Date('2024-01-01'),
      });
      mockBlacklistService.unblacklistUser.mockRejectedValue(new Error('Database error'));

      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Unblacklist Failed',
            description: 'Unable to remove the user from blacklist.',
            color: 0xf44336,
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

  describe('List Subcommand', () => {
    beforeEach(() => {
      mockContext.args = ['list'];
    });

    it('should show empty list message when no users are blacklisted', async () => {
      mockBlacklistService.getBlacklistedUsers.mockResolvedValue([]);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.getBlacklistedUsers).toHaveBeenCalled();
      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '📋 Blacklist Empty',
            description: 'No users are currently blacklisted.',
            color: 0x2196f3,
          }),
        ],
      });
    });

    it('should list blacklisted users', async () => {
      mockBlacklistService.getBlacklistedUsers.mockResolvedValue([
        { userId: { toString: () => '111111111111111111' }, reason: 'Spamming', blacklistedBy: { toString: () => '987654321' }, blacklistedAt: new Date('2024-01-01') },
        { userId: { toString: () => '222222222222222222' }, reason: 'API abuse', blacklistedBy: { toString: () => '987654321' }, blacklistedAt: new Date('2024-01-01') },
        { userId: { toString: () => '333333333333333333' }, reason: null, blacklistedBy: { toString: () => '987654321' }, blacklistedAt: new Date('2024-01-01') },
      ]);

      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🚫 Blacklisted Users',
            description: expect.stringContaining('**1.** <@111111111111111111>\n   Reason: Spamming'),
            color: 0xf44336,
            footer: {
              text: 'Total: 3 blacklisted users',
            },
          }),
        ],
      });
    });

    it('should paginate long blacklist', async () => {
      // Create 15 blacklisted users
      const blacklistedUsers = Array.from({ length: 15 }, (_, i) => ({
        userId: `11111111111111111${i}`,
        blacklistReason: `Reason ${i + 1}`,
      }));
      mockBlacklistService.getBlacklistedUsers.mockResolvedValue(
        blacklistedUsers.map(u => ({
          userId: { toString: () => u.userId },
          reason: u.blacklistReason,
          blacklistedBy: { toString: () => '987654321' },
          blacklistedAt: new Date('2024-01-01'),
        }))
      );

      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: '🚫 Blacklisted Users',
            description: expect.any(String), // First 10 users
          }),
          expect.objectContaining({
            title: undefined, // No title on second page
            description: expect.any(String), // Remaining 5 users
            footer: {
              text: 'Total: 15 blacklisted users',
            },
          }),
        ]),
      });
    });

    it('should handle list errors', async () => {
      mockBlacklistService.getBlacklistedUsers.mockRejectedValue(new Error('Database error'));

      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ List Failed',
            description: 'Unable to retrieve the blacklist.',
            color: 0xf44336,
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

  describe('Check Subcommand', () => {
    beforeEach(() => {
      mockContext.args = ['check'];
    });

    it('should check blacklisted user using options', async () => {
      mockContext.options = {
        action: 'check',
        user: { id: '111111111111111111' },
      };
      mockBlacklistService.getBlacklistDetails.mockResolvedValue({
        userId: { toString: () => '111111111111111111' },
        reason: 'Spam',
        blacklistedBy: { toString: () => '987654321' },
        blacklistedAt: new Date('2024-01-01'),
      });

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.getBlacklistDetails).toHaveBeenCalledWith('111111111111111111');
      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '🚫 User is Blacklisted',
            description: '<@111111111111111111> is currently blacklisted.',
            color: 0xf44336,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Status',
                value: '🚫 Blacklisted',
              }),
              expect.objectContaining({
                name: 'Reason',
                value: 'Spam',
              }),
            ]),
          }),
        ],
      });
    });

    it('should check non-blacklisted user', async () => {
      mockContext.args = ['check', '111111111111111111'];
      mockBlacklistService.getBlacklistDetails.mockResolvedValue(null);

      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ User Not Blacklisted',
            description: '<@111111111111111111> is not blacklisted.',
            color: 0x4caf50,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Status',
                value: '✅ Not blacklisted',
              }),
              expect.objectContaining({
                name: 'Bot Access',
                value: '✅ Can use all bot features',
              }),
            ]),
          }),
        ],
      });
    });

    it('should show error when user is missing', async () => {
      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ User Required',
            description: 'Please specify a user to check.',
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle check errors', async () => {
      mockContext.args = ['check', '111111111111111111'];
      mockBlacklistService.getBlacklistDetails.mockRejectedValue(new Error('Database error'));

      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Check Failed',
            description: 'Unable to check blacklist status.',
            color: 0xf44336,
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

  describe('Error Handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      mockContext.hasPermission.mockRejectedValue(new Error('Permission check failed'));
      
      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Blacklist Error',
            description: 'An unexpected error occurred while processing your blacklist request.',
            color: 0xf44336,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Error details',
                value: 'Permission check failed',
              }),
            ]),
            footer: expect.objectContaining({
              text: expect.stringMatching(/^Error ID: \d+$/),
            }),
          }),
        ],
      });
    });

    it('should log errors', async () => {
      mockContext.hasPermission.mockRejectedValue(new Error('Test error'));
      
      await blacklistCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[BlacklistCommand] Unexpected error:',
        expect.any(Error)
      );
    });
  });

  describe('Edge Cases', () => {
    it('should extract user ID from various mention formats', async () => {
      const testCases = [
        { input: '<@111111111111111111>', expected: '111111111111111111' },
        { input: '<@!111111111111111111>', expected: '111111111111111111' },
        { input: '111111111111111111', expected: '111111111111111111' },
      ];

      for (const { input, expected } of testCases) {
        jest.clearAllMocks();
        mockContext.args = ['add', input, 'Test'];
        mockBlacklistService.isUserBlacklisted.mockResolvedValue(false);
        mockBlacklistService.blacklistUser.mockResolvedValue(undefined);

        await blacklistCommand.execute(mockContext);

        expect(mockBlacklistService.blacklistUser).toHaveBeenCalledWith(expected, 'Test', mockContext.userId);
      }
    });

    it('should ignore invalid user ID formats', async () => {
      mockContext.args = ['add', 'not-a-valid-id'];
      
      await blacklistCommand.execute(mockContext);

      expect(mockRespond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ User Required',
            description: 'Please specify a user to blacklist.',
          }),
        ],
      });
    });

    it('should use action from options over args', async () => {
      mockContext.args = ['add']; // Different action in args
      mockContext.options = {
        action: 'list', // This should take precedence
      };
      mockBlacklistService.getBlacklistedUsers.mockResolvedValue([]);

      await blacklistCommand.execute(mockContext);

      expect(mockBlacklistService.getBlacklistedUsers).toHaveBeenCalled();
    });
  });
});