/**
 * Tests for VerifyCommand
 */

const {
  createVerifyCommand,
} = require('../../../../../src/application/commands/authentication/VerifyCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const logger = require('../../../../../src/logger');

// Mock logger
jest.mock('../../../../../src/logger');

describe('VerifyCommand', () => {
  let verifyCommand;
  let mockContext;
  let mockAuthenticationService;
  let mockChannelUtils;
  let migrationHelper;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    migrationHelper = createMigrationHelper();
    verifyCommand = createVerifyCommand();

    // Mock DDD authentication service
    mockAuthenticationService = {
      getAuthenticationStatus: jest.fn().mockResolvedValue({
        isAuthenticated: true,
        user: {
          nsfwStatus: {
            verified: false
          }
        }
      }),
      verifyNsfwAccess: jest.fn().mockResolvedValue()
    };

    // Mock channel utils
    mockChannelUtils = {
      isChannelNSFW: jest.fn().mockReturnValue(false),
    };

    // Mock context
    mockContext = {
      userId: 'user123',
      channelId: 'channel123',
      guildId: 'guild123',
      commandPrefix: '!tz',
      isDM: jest.fn().mockReturnValue(false),
      getGuildId: jest.fn().mockReturnValue('guild123'),
      args: [],
      options: {},
      dependencies: {
        authenticationService: mockAuthenticationService,
        channelUtils: mockChannelUtils,
      },
      respond: jest.fn().mockResolvedValue(undefined),
      isChannelNSFW: jest.fn().mockResolvedValue(false),
      originalMessage: {
        guild: {
          channels: {
            cache: new Map(),
          },
        },
        member: {
          id: 'user123',
        },
      },
    };
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(verifyCommand.name).toBe('verify');
      expect(verifyCommand.description).toBe(
        'Verify your age to use AI personalities in Direct Messages'
      );
      expect(verifyCommand.category).toBe('Authentication');
      expect(verifyCommand.aliases).toEqual(['nsfw']);
      expect(verifyCommand.options).toHaveLength(0);
    });
  });

  describe('DM channel handling', () => {
    it('should explain verification requirements when run in DM', async () => {
      mockContext.isDM.mockReturnValue(true);
      mockContext.getGuildId.mockReturnValue(null);

      await verifyCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '⚠️ Age Verification Required',
            description: expect.stringContaining('must be run in a server channel marked as NSFW'),
            color: 0xff9800,
          }),
        ],
      });
    });
  });

  describe('already verified users', () => {
    it('should inform already verified users', async () => {
      mockAuthenticationService.getAuthenticationStatus.mockResolvedValue({
        isAuthenticated: true,
        user: {
          nsfwStatus: {
            verified: true
          }
        }
      });

      await verifyCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Already Verified',
            description: expect.stringContaining('already verified to access AI personalities'),
            color: 0x4caf50,
          }),
        ],
      });
      expect(mockAuthenticationService.verifyNsfwAccess).not.toHaveBeenCalled();
    });
  });

  describe('NSFW channel verification', () => {
    it('should verify user in NSFW channel', async () => {
      mockContext.isChannelNSFW.mockResolvedValue(true);

      await verifyCommand.execute(mockContext);

      expect(mockAuthenticationService.verifyNsfwAccess).toHaveBeenCalledWith('user123');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Verification Successful',
            description: expect.stringContaining('successfully verified to use AI personalities'),
            color: 0x4caf50,
          }),
        ],
      });
    });

    it('should handle verification storage failure', async () => {
      mockContext.isChannelNSFW.mockResolvedValue(true);
      mockAuthenticationService.verifyNsfwAccess.mockRejectedValue(new Error('Storage error'));

      await verifyCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Verification Error',
            description: expect.stringContaining('error storing your verification status'),
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('NSFW channel access check', () => {
    it('should verify user with access to other NSFW channels', async () => {
      // Create mock channels
      const nsfwChannel = {
        id: 'nsfw-channel-123',
        isTextBased: () => true,
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true),
        }),
      };

      const regularChannel = {
        id: 'regular-channel-123',
        isTextBased: () => true,
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true),
        }),
      };

      mockContext.originalMessage.guild.channels.cache.set('nsfw-channel-123', nsfwChannel);
      mockContext.originalMessage.guild.channels.cache.set('regular-channel-123', regularChannel);

      // Mock channel utils to identify NSFW channels
      mockChannelUtils.isChannelNSFW.mockImplementation(channel => {
        return channel.id === 'nsfw-channel-123';
      });

      await verifyCommand.execute(mockContext);

      expect(mockAuthenticationService.verifyNsfwAccess).toHaveBeenCalledWith('user123');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Verification Successful',
            description: expect.stringContaining('successfully verified to use AI personalities'),
            color: 0x4caf50,
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'NSFW channels you can access',
                value: expect.stringContaining('<#nsfw-channel-123>'),
              }),
            ]),
          }),
        ],
      });
    });

    it('should deny verification when no NSFW channels accessible', async () => {
      // Create mock channel without NSFW
      const regularChannel = {
        id: 'regular-channel-123',
        isTextBased: () => true,
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true),
        }),
      };

      mockContext.originalMessage.guild.channels.cache.set('regular-channel-123', regularChannel);

      await verifyCommand.execute(mockContext);

      expect(mockAuthenticationService.verifyNsfwAccess).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '⚠️ Unable to Verify',
            description: expect.stringContaining(
              'Age verification requires access to NSFW channels'
            ),
            color: 0xff9800,
          }),
        ],
      });
    });

    it('should handle missing guild information', async () => {
      mockContext.getGuildId.mockReturnValue(null);
      mockContext.originalMessage.guild = null;

      await verifyCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Verification Error',
            description: expect.stringContaining('Unable to verify server information'),
            color: 0xf44336,
          }),
        ],
      });
    });

    it('should handle channel permission check errors', async () => {
      const nsfwChannel = {
        id: 'nsfw-channel-123',
        isTextBased: () => true,
        permissionsFor: jest.fn().mockImplementation(() => {
          throw new Error('Permission check failed');
        }),
      };

      mockContext.originalMessage.guild.channels.cache.set('nsfw-channel-123', nsfwChannel);
      mockChannelUtils.isChannelNSFW.mockReturnValue(true);

      await verifyCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Verification Error',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('storage verification', () => {
    it('should handle verification storage error in NSFW channel list', async () => {
      // Create mock NSFW channel
      const nsfwChannel = {
        id: 'nsfw-channel-123',
        isTextBased: () => true,
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true),
        }),
      };

      mockContext.originalMessage.guild.channels.cache.set('nsfw-channel-123', nsfwChannel);
      mockChannelUtils.isChannelNSFW.mockReturnValue(true);
      mockAuthenticationService.verifyNsfwAccess.mockRejectedValue(new Error('Storage failed'));

      await verifyCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Verification Error',
            description: expect.stringContaining('error storing your verification status'),
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      mockAuthenticationService.getAuthenticationStatus.mockRejectedValue(new Error('Database error'));

      await verifyCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Unexpected Error',
            description: expect.stringContaining('An unexpected error occurred'),
            color: 0xf44336,
          }),
        ],
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle missing original message', async () => {
      mockContext.originalMessage = null;

      await verifyCommand.execute(mockContext);

      // Should still work, just won't find any NSFW channels
      expect(mockContext.respond).toHaveBeenCalled();
    });
  });

  describe('channel accessibility', () => {
    it('should only count channels user can view', async () => {
      // Create mock channels with different permissions
      const visibleNsfwChannel = {
        id: 'visible-nsfw-123',
        isTextBased: () => true,
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true), // Can view
        }),
      };

      const hiddenNsfwChannel = {
        id: 'hidden-nsfw-123',
        isTextBased: () => true,
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(false), // Cannot view
        }),
      };

      mockContext.originalMessage.guild.channels.cache.set('visible-nsfw-123', visibleNsfwChannel);
      mockContext.originalMessage.guild.channels.cache.set('hidden-nsfw-123', hiddenNsfwChannel);

      // Both are NSFW but only one is visible
      mockChannelUtils.isChannelNSFW.mockReturnValue(true);

      await verifyCommand.execute(mockContext);

      // Should succeed because user has access to at least one NSFW channel
      expect(mockAuthenticationService.verifyNsfwAccess).toHaveBeenCalledWith('user123');
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Verification Successful',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'NSFW channels you can access',
                value: expect.stringContaining('<#visible-nsfw-123>'),
              }),
            ]),
          }),
        ],
      });
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.not.arrayContaining([
              expect.objectContaining({
                value: expect.stringContaining('<#hidden-nsfw-123>'),
              }),
            ]),
          }),
        ],
      });
    });

    it('should only check text-based channels', async () => {
      // Create voice channel (not text-based)
      const voiceChannel = {
        id: 'voice-channel-123',
        isTextBased: () => false,
        permissionsFor: jest.fn().mockReturnValue({
          has: jest.fn().mockReturnValue(true),
        }),
      };

      mockContext.originalMessage.guild.channels.cache.set('voice-channel-123', voiceChannel);
      mockChannelUtils.isChannelNSFW.mockReturnValue(true);

      await verifyCommand.execute(mockContext);

      // Should not find any NSFW channels since voice channels don't count
      expect(mockAuthenticationService.verifyNsfwAccess).not.toHaveBeenCalled();
      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '⚠️ Unable to Verify',
            description: expect.stringContaining(
              'Age verification requires access to NSFW channels'
            ),
            color: 0xff9800,
          }),
        ],
      });
    });
  });
});
