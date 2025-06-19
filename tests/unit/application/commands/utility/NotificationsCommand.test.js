/**
 * Tests for NotificationsCommand
 */

const {
  createNotificationsCommand,
  getLevelDescription,
} = require('../../../../../src/application/commands/utility/NotificationsCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const logger = require('../../../../../src/logger');

// Mock logger
jest.mock('../../../../../src/logger');

describe('NotificationsCommand', () => {
  let notificationsCommand;
  let mockContext;
  let mockReleaseNotificationManager;
  let mockPreferences;
  let migrationHelper;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    migrationHelper = createMigrationHelper();

    // Mock preferences
    mockPreferences = {
      getUserPreferences: jest.fn().mockReturnValue({
        optedOut: false,
        notificationLevel: 'minor',
        lastNotified: null,
      }),
      setOptOut: jest.fn().mockResolvedValue(undefined),
      setNotificationLevel: jest.fn().mockResolvedValue(undefined),
    };

    // Mock release notification manager
    mockReleaseNotificationManager = {
      preferences: mockPreferences,
    };

    // Create command with mocked dependencies
    notificationsCommand = createNotificationsCommand({
      releaseNotificationManager: mockReleaseNotificationManager,
    });

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
    };
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(notificationsCommand.name).toBe('notifications');
      expect(notificationsCommand.description).toBe('Manage release notification preferences');
      expect(notificationsCommand.category).toBe('Utility');
      expect(notificationsCommand.aliases).toEqual(['notif', 'notify']);
      expect(notificationsCommand.options).toHaveLength(2);
    });
  });

  describe('getLevelDescription', () => {
    it('should return correct descriptions for each level', () => {
      expect(getLevelDescription('major')).toContain('Major releases only');
      expect(getLevelDescription('minor')).toContain('Minor and major releases');
      expect(getLevelDescription('patch')).toContain('All releases');
      expect(getLevelDescription('none')).toContain('No notifications');
      expect(getLevelDescription('unknown')).toContain('Minor and major releases');
    });
  });

  describe('status subcommand', () => {
    it('should show status when no subcommand provided', async () => {
      await notificationsCommand.execute(mockContext);

      expect(mockPreferences.getUserPreferences).toHaveBeenCalledWith('user123');
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 0x00ff00,
          title: '📬 Release Notification Settings',
          description: '✅ You are **opted in** to release notifications.',
        })
      );
    });

    it('should show status for opted out user', async () => {
      mockPreferences.getUserPreferences.mockReturnValue({
        optedOut: true,
        notificationLevel: 'minor',
        lastNotified: '2024-01-01',
      });

      mockContext.args = ['status'];
      await notificationsCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 0xff0000,
          description: '❌ You are **opted out** of release notifications.',
          fields: expect.arrayContaining([
            { name: 'Last Notified', value: '2024-01-01', inline: true },
          ]),
        })
      );
    });

    it('should show text fallback when embed not supported', async () => {
      delete mockContext.respondWithEmbed;

      await notificationsCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(expect.stringContaining('opted in to'));
      expect(mockContext.respond).toHaveBeenCalledWith(expect.stringContaining('Level: minor'));
    });

    it('should handle status errors gracefully', async () => {
      mockPreferences.getUserPreferences.mockImplementation(() => {
        throw new Error('Database error');
      });

      await notificationsCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[NotificationsCommand] Error showing status:',
        expect.any(Error)
      );
      expect(mockContext.respond).toHaveBeenCalledWith(
        'An error occurred while fetching your notification settings.'
      );
    });
  });

  describe('opt out subcommand', () => {
    it('should opt user out with embed response', async () => {
      mockContext.args = ['off'];

      await notificationsCommand.execute(mockContext);

      expect(mockPreferences.setOptOut).toHaveBeenCalledWith('user123', true);
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 0xff0000,
          title: '🔕 Opted Out',
          description: 'You have been opted out of release notifications.',
        })
      );
    });

    it('should opt user out with text response', async () => {
      delete mockContext.respondWithEmbed;
      mockContext.args = ['off'];

      await notificationsCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        '🔕 You have been opted out of release notifications.'
      );
    });

    it('should handle opt out errors', async () => {
      mockContext.args = ['off'];
      mockPreferences.setOptOut.mockRejectedValue(new Error('Save failed'));

      await notificationsCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[NotificationsCommand] Error opting out:',
        expect.any(Error)
      );
      expect(mockContext.respond).toHaveBeenCalledWith(
        'An error occurred while updating your preferences.'
      );
    });
  });

  describe('opt in subcommand', () => {
    it('should opt user in with embed response', async () => {
      mockContext.args = ['on'];

      await notificationsCommand.execute(mockContext);

      expect(mockPreferences.setOptOut).toHaveBeenCalledWith('user123', false);
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 0x00ff00,
          title: '🔔 Opted In',
          description: 'You have been opted in to release notifications.',
          fields: expect.arrayContaining([expect.objectContaining({ name: 'Current Level' })]),
        })
      );
    });

    it('should opt user in with text response', async () => {
      delete mockContext.respondWithEmbed;
      mockContext.args = ['on'];

      await notificationsCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('🔔 You have been opted in')
      );
    });

    it('should handle opt in errors', async () => {
      mockContext.args = ['on'];
      mockPreferences.setOptOut.mockRejectedValue(new Error('Save failed'));

      await notificationsCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[NotificationsCommand] Error opting in:',
        expect.any(Error)
      );
    });
  });

  describe('level subcommand', () => {
    it('should set notification level with embed response', async () => {
      mockContext.args = ['level', 'major'];

      await notificationsCommand.execute(mockContext);

      expect(mockPreferences.setNotificationLevel).toHaveBeenCalledWith('user123', 'major');
      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 0x0099ff,
          title: '⚙️ Notification Level Updated',
          description: 'Your notification level has been set to **major**.',
        })
      );
    });

    it('should set notification level with text response', async () => {
      delete mockContext.respondWithEmbed;
      mockContext.args = ['level', 'patch'];

      await notificationsCommand.execute(mockContext);

      expect(mockPreferences.setNotificationLevel).toHaveBeenCalledWith('user123', 'patch');
      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('Your notification level has been set to **patch**')
      );
    });

    it('should handle missing level argument', async () => {
      mockContext.args = ['level'];

      await notificationsCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        'Please specify a level: `major`, `minor`, or `patch`.'
      );
      expect(mockPreferences.setNotificationLevel).not.toHaveBeenCalled();
    });

    it('should handle invalid level argument', async () => {
      mockContext.args = ['level', 'invalid'];

      await notificationsCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        expect.stringContaining('Invalid level. Choose from:')
      );
      expect(mockPreferences.setNotificationLevel).not.toHaveBeenCalled();
    });

    it('should handle level setting errors', async () => {
      mockContext.args = ['level', 'minor'];
      mockPreferences.setNotificationLevel.mockRejectedValue(new Error('Save failed'));

      await notificationsCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[NotificationsCommand] Error setting level:',
        expect.any(Error)
      );
    });
  });

  describe('invalid subcommand', () => {
    it('should show error for invalid subcommand', async () => {
      mockContext.args = ['invalid'];

      await notificationsCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith(
        'Invalid subcommand. Use `status`, `on`, `off`, or `level <major|minor|patch>`.'
      );
    });
  });

  describe('options support', () => {
    it('should support action option for slash commands', async () => {
      mockContext.options = { action: 'off' };

      await notificationsCommand.execute(mockContext);

      expect(mockPreferences.setOptOut).toHaveBeenCalledWith('user123', true);
    });

    it('should support level option for slash commands', async () => {
      mockContext.options = { action: 'level', level: 'major' };

      await notificationsCommand.execute(mockContext);

      expect(mockPreferences.setNotificationLevel).toHaveBeenCalledWith('user123', 'major');
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors', async () => {
      // Create a scenario where the release notification manager throws an error
      const errorManager = {
        preferences: {
          getUserPreferences: jest.fn().mockImplementation(() => {
            throw new Error('Database connection failed');
          }),
        },
      };

      const errorCommand = createNotificationsCommand({
        releaseNotificationManager: errorManager,
      });

      await errorCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[NotificationsCommand] Error showing status:',
        expect.any(Error)
      );
      expect(mockContext.respond).toHaveBeenCalledWith(
        'An error occurred while fetching your notification settings.'
      );
    });
  });

  describe('factory function', () => {
    it('should create command with default dependencies', () => {
      const command = createNotificationsCommand();

      expect(command).toBeDefined();
      expect(command.name).toBe('notifications');
    });

    it('should create command with custom dependencies', () => {
      const customManager = { preferences: {} };
      const command = createNotificationsCommand({
        releaseNotificationManager: customManager,
      });

      expect(command).toBeDefined();
      expect(command.name).toBe('notifications');
    });
  });
});
