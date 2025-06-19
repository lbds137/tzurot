/**
 * Tests for notifications command
 */

const { EmbedBuilder } = require('discord.js');
const notificationsCommand = require('../../../../src/commands/handlers/notifications');
const logger = require('../../../../src/logger');
const commandValidator = require('../../../../src/commands/utils/commandValidator');

// Mock dependencies
jest.mock('../../../../src/logger');
jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setColor: jest.fn().mockReturnThis(),
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
  })),
}));
jest.mock('../../../../src/commands/utils/commandValidator', () => ({
  createDirectSend: jest.fn(() => jest.fn()),
}));

describe('notifications command', () => {
  let mockMessage;
  let mockReleaseNotificationManager;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up logger mock
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();

    // Mock message
    mockMessage = {
      author: { id: 'user123' },
      reply: jest.fn().mockResolvedValue({}),
    };

    // Mock release notification manager
    mockReleaseNotificationManager = {
      preferences: {
        getUserPreferences: jest.fn(),
        setOptOut: jest.fn(),
        setNotificationLevel: jest.fn(),
      },
    };
  });

  describe('command metadata', () => {
    it('should have correct command properties', () => {
      expect(notificationsCommand.meta.name).toBe('notifications');
      expect(notificationsCommand.meta.aliases).toEqual(['notif', 'notify']);
      expect(notificationsCommand.meta.category).toBe('utility');
      expect(notificationsCommand.meta.description).toBeTruthy();
      expect(notificationsCommand.meta.usage).toBeTruthy();
      expect(notificationsCommand.meta.examples).toBeInstanceOf(Array);
    });
  });

  describe('execute - no subcommand (status)', () => {
    it('should show status when no subcommand provided', async () => {
      mockReleaseNotificationManager.preferences.getUserPreferences.mockReturnValue({
        optedOut: false,
        notificationLevel: 'minor',
        lastNotified: '1.0.0',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      });

      await notificationsCommand.execute(mockMessage, [], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(mockMessage.reply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });

      const embed = EmbedBuilder.mock.results[0].value;
      expect(embed.setColor).toHaveBeenCalledWith(0x00ff00); // Green for opted in
      expect(embed.setDescription).toHaveBeenCalledWith(
        '✅ You are **opted in** to release notifications.'
      );
    });
  });

  describe('execute - status subcommand', () => {
    it('should show opted out status', async () => {
      mockReleaseNotificationManager.preferences.getUserPreferences.mockReturnValue({
        optedOut: true,
        notificationLevel: 'major',
        lastNotified: null,
      });

      await notificationsCommand.execute(mockMessage, ['status'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      const embed = EmbedBuilder.mock.results[0].value;
      expect(embed.setColor).toHaveBeenCalledWith(0xff0000); // Red for opted out
      expect(embed.setDescription).toHaveBeenCalledWith(
        '❌ You are **opted out** of release notifications.'
      );
    });

    it('should handle errors gracefully', async () => {
      mockReleaseNotificationManager.preferences.getUserPreferences.mockImplementation(() => {
        throw new Error('Database error');
      });

      await notificationsCommand.execute(mockMessage, ['status'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error showing status'));
      expect(mockMessage.reply).toHaveBeenCalledWith(
        'An error occurred while fetching your notification settings.'
      );
    });
  });

  describe('execute - off subcommand', () => {
    it('should opt user out', async () => {
      mockReleaseNotificationManager.preferences.setOptOut.mockResolvedValue();

      await notificationsCommand.execute(mockMessage, ['off'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(mockReleaseNotificationManager.preferences.setOptOut).toHaveBeenCalledWith(
        'user123',
        true
      );

      const embed = EmbedBuilder.mock.results[0].value;
      expect(embed.setColor).toHaveBeenCalledWith(0xff0000);
      expect(embed.setTitle).toHaveBeenCalledWith('🔕 Opted Out');
    });

    it('should handle opt-out errors', async () => {
      mockReleaseNotificationManager.preferences.setOptOut.mockRejectedValue(
        new Error('Save failed')
      );

      await notificationsCommand.execute(mockMessage, ['off'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error opting out'));
      expect(mockMessage.reply).toHaveBeenCalledWith(
        'An error occurred while updating your preferences.'
      );
    });
  });

  describe('execute - on subcommand', () => {
    it('should opt user in', async () => {
      mockReleaseNotificationManager.preferences.setOptOut.mockResolvedValue();
      mockReleaseNotificationManager.preferences.getUserPreferences.mockReturnValue({
        notificationLevel: 'minor',
      });

      await notificationsCommand.execute(mockMessage, ['on'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(mockReleaseNotificationManager.preferences.setOptOut).toHaveBeenCalledWith(
        'user123',
        false
      );

      const embed = EmbedBuilder.mock.results[0].value;
      expect(embed.setColor).toHaveBeenCalledWith(0x00ff00);
      expect(embed.setTitle).toHaveBeenCalledWith('🔔 Opted In');
    });
  });

  describe('execute - level subcommand', () => {
    it('should set notification level', async () => {
      mockReleaseNotificationManager.preferences.setNotificationLevel.mockResolvedValue();

      await notificationsCommand.execute(mockMessage, ['level', 'major'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(mockReleaseNotificationManager.preferences.setNotificationLevel).toHaveBeenCalledWith(
        'user123',
        'major'
      );

      const embed = EmbedBuilder.mock.results[0].value;
      expect(embed.setColor).toHaveBeenCalledWith(0x0099ff);
      expect(embed.setTitle).toHaveBeenCalledWith('⚙️ Notification Level Updated');
      expect(embed.setDescription).toHaveBeenCalledWith(
        'Your notification level has been set to **major**.'
      );
    });

    it('should require level parameter', async () => {
      await notificationsCommand.execute(mockMessage, ['level'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(mockMessage.reply).toHaveBeenCalledWith(
        'Please specify a level: `major`, `minor`, or `patch`.'
      );
    });

    it('should validate level parameter', async () => {
      await notificationsCommand.execute(mockMessage, ['level', 'invalid'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(mockMessage.reply).toHaveBeenCalledWith(
        'Invalid level. Choose from: `major`, `minor`, `patch`'
      );
    });

    it('should handle level setting errors', async () => {
      mockReleaseNotificationManager.preferences.setNotificationLevel.mockRejectedValue(
        new Error('Invalid level')
      );

      await notificationsCommand.execute(mockMessage, ['level', 'major'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error setting level'));
      expect(mockMessage.reply).toHaveBeenCalledWith(
        'An error occurred while updating your notification level.'
      );
    });
  });

  describe('execute - invalid subcommand', () => {
    it('should show error for invalid subcommand', async () => {
      const mockDirectSend = jest.fn();
      commandValidator.createDirectSend.mockReturnValue(mockDirectSend);

      await notificationsCommand.execute(mockMessage, ['invalid'], {
        releaseNotificationManager: mockReleaseNotificationManager,
      });

      expect(mockDirectSend).toHaveBeenCalledWith(
        'Invalid subcommand. Use `status`, `on`, `off`, or `level <major|minor|patch>`.'
      );
    });
  });

  // Note: getLevelDescription is now a private function and not directly testable
  // Its functionality is tested through the execute method tests above
});
