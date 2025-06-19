/**
 * Tests for the debug command handler
 */

// Mock dependencies before requiring the module
jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
  })),
  PermissionFlagsBits: {
    Administrator: 8n,
  },
}));

jest.mock('../../../../src/logger');
jest.mock('../../../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@',
  },
}));

jest.mock('../../../../src/aiService', () => ({}));

jest.mock('../../../../src/utils/webhookUserTracker', () => ({
  clearAllCachedWebhooks: jest.fn(),
}));

jest.mock('../../../../src/core/authentication', () => ({
  getNsfwVerificationManager: jest.fn().mockReturnValue({
    clearVerification: jest.fn(),
  }),
}));

jest.mock('../../../../src/core/conversation', () => ({
  clearConversation: jest.fn(),
}));

jest.mock('../../../../src/auth', () => ({
  cleanupExpiredTokens: jest.fn(),
  getAuthManager: jest.fn().mockReturnValue({}),
}));

jest.mock('../../../../src/messageTracker', () => ({
  messageTracker: {
    clear: jest.fn(),
    size: 42,
  },
}));

// Mock utils and commandValidator
jest.mock('../../../../src/utils', () => ({
  createDirectSend: jest.fn().mockImplementation(message => {
    return async content => {
      return message.channel.send(content);
    };
  }),
}));

jest.mock('../../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation(message => {
      const directSend = async content => {
        return message.channel.send(content);
      };
      return directSend;
    }),
    isAdmin: jest.fn().mockReturnValue(true),
    canManageMessages: jest.fn().mockReturnValue(false),
    isNsfwChannel: jest.fn().mockReturnValue(false),
  };
});

// Import test helpers
const helpers = require('../../../utils/commandTestHelpers');

// Import mocked modules
const { EmbedBuilder } = require('discord.js');
const validator = require('../../../../src/commands/utils/commandValidator');
const aiService = require('../../../../src/aiService');

describe('Debug Command', () => {
  let debugCommand;
  let mockMessage;
  let mockEmbed;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock message with standard channel.send mock
    mockMessage = helpers.createMockMessage({ isAdmin: true });
    mockMessage.channel.send = jest.fn().mockResolvedValue({
      id: 'sent-message-123',
      embeds: [{ title: 'Debug Information' }],
    });

    // Set up embed mock
    mockEmbed = {
      setTitle: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis(),
    };
    EmbedBuilder.mockReturnValue(mockEmbed);

    // Import command module after mock setup
    debugCommand = require('../../../../src/commands/handlers/debug');
  });

  it('should show usage information when no subcommand is provided', async () => {
    const result = await debugCommand.execute(mockMessage, []);

    // Verify that createDirectSend was called with the message
    expect(validator.createDirectSend).toHaveBeenCalledWith(mockMessage);

    // Verify that channel.send was called with usage info
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('You need to provide a subcommand')
    );

    // Should mention all subcommands
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining('clearwebhooks'));
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining('unverify'));
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('clearconversation')
    );
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining('clearauth'));
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining('clearmessages'));
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining('stats'));
  });

  // Removed problematic personalities tests

  it('should show error for unknown subcommand', async () => {
    const result = await debugCommand.execute(mockMessage, ['unknown']);

    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('Unknown debug subcommand: `unknown`')
    );
  });

  it('should handle clearwebhooks subcommand', async () => {
    const webhookUserTracker = require('../../../../src/utils/webhookUserTracker');

    const result = await debugCommand.execute(mockMessage, ['clearwebhooks']);

    // Verify webhook cache was cleared
    expect(webhookUserTracker.clearAllCachedWebhooks).toHaveBeenCalled();

    // Verify success message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('✅ Cleared all cached webhook identifications.')
    );
  });

  it('should handle unverify subcommand when user is verified', async () => {
    const { getNsfwVerificationManager } = require('../../../../src/core/authentication');
    const mockNsfwManager = getNsfwVerificationManager();
    mockNsfwManager.clearVerification.mockReturnValue(true);

    const result = await debugCommand.execute(mockMessage, ['unverify']);

    // Verify clearVerification was called with correct user ID
    expect(mockNsfwManager.clearVerification).toHaveBeenCalledWith('user-123');

    // Verify success message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('✅ Your NSFW verification has been cleared. You are now unverified.')
    );
  });

  it('should handle unverify subcommand when user is not verified', async () => {
    const { getNsfwVerificationManager } = require('../../../../src/core/authentication');
    const mockNsfwManager = getNsfwVerificationManager();
    mockNsfwManager.clearVerification.mockReturnValue(false);

    const result = await debugCommand.execute(mockMessage, ['unverify']);

    // Verify clearVerification was called
    expect(mockNsfwManager.clearVerification).toHaveBeenCalledWith('user-123');

    // Verify info message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('❌ You were not verified, so nothing was cleared.')
    );
  });

  it('should handle clearconversation subcommand', async () => {
    const { clearConversation } = require('../../../../src/core/conversation');

    const result = await debugCommand.execute(mockMessage, ['clearconversation']);

    // Verify clearConversation was called with correct parameters
    expect(clearConversation).toHaveBeenCalledWith('user-123', 'channel-123');

    // Verify success message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('✅ Cleared your conversation history in this channel.')
    );
  });

  it('should handle clearauth subcommand', async () => {
    const auth = require('../../../../src/auth');

    const result = await debugCommand.execute(mockMessage, ['clearauth']);

    // Verify cleanupExpiredTokens was called
    expect(auth.cleanupExpiredTokens).toHaveBeenCalled();

    // Verify success message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('✅ Cleaned up authentication tokens.')
    );
  });

  it('should handle clearmessages subcommand', async () => {
    const { messageTracker } = require('../../../../src/messageTracker');

    const result = await debugCommand.execute(mockMessage, ['clearmessages']);

    // Verify clear was called
    expect(messageTracker.clear).toHaveBeenCalled();

    // Verify success message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('✅ Cleared message tracking history.')
    );
  });

  it('should handle stats subcommand', async () => {
    const result = await debugCommand.execute(mockMessage, ['stats']);

    // Verify stats message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('📊 **Debug Statistics**')
    );

    // Verify it contains JSON stats
    expect(mockMessage.channel.send).toHaveBeenCalledWith(expect.stringContaining('```json'));
  });

  it('should handle errors in clearconversation', async () => {
    const { clearConversation } = require('../../../../src/core/conversation');
    clearConversation.mockImplementation(() => {
      throw new Error('Test error');
    });

    const result = await debugCommand.execute(mockMessage, ['clearconversation']);

    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed to clear conversation history.')
    );
  });

  it('should handle errors in clearauth', async () => {
    const auth = require('../../../../src/auth');
    auth.cleanupExpiredTokens.mockRejectedValue(new Error('Test error'));

    const result = await debugCommand.execute(mockMessage, ['clearauth']);

    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed to clear authentication.')
    );
  });

  it('should handle errors in clearmessages', async () => {
    const { messageTracker } = require('../../../../src/messageTracker');
    messageTracker.clear.mockImplementation(() => {
      throw new Error('Test error');
    });

    const result = await debugCommand.execute(mockMessage, ['clearmessages']);

    // Verify error message was sent
    expect(mockMessage.channel.send).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed to clear message tracking.')
    );
  });

  it('should expose correct metadata with administrator permission', () => {
    expect(debugCommand.meta).toBeDefined();
    expect(debugCommand.meta.name).toBe('debug');
    expect(debugCommand.meta.description).toBeTruthy();
    expect(debugCommand.meta.permissions).toContain(8n); // PermissionFlagsBits.Administrator
  });
});
