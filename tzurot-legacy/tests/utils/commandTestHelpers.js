/**
 * Command Test Helpers
 * Utilities for testing command handlers
 *
 * UPDATED: Cleaned up implementation while maintaining backward compatibility
 * This version is more maintainable and follows DRY principles without depending
 * on the consolidated mock system at runtime (which requires Jest globals)
 */

/**
 * Creates a mock Discord message object for testing
 * @param {Object} options - Options for the mock message
 * @returns {Object} Mock message object
 */
function createMockMessage(options = {}) {
  // Default options
  const defaults = {
    id: 'mock-message-123',
    authorId: 'user-123',
    authorTag: 'User#1234',
    channelId: 'channel-123',
    isDM: false,
    isAdmin: false,
    canManageMessages: false,
    isNSFW: false,
    guildId: 'guild-123',
    replyContent: null,
  };

  // Merge provided options with defaults
  const config = { ...defaults, ...options };

  // Create mock author
  const mockAuthor = {
    id: config.authorId,
    tag: config.authorTag,
    username: config.authorTag.split('#')[0],
    discriminator: config.authorTag.split('#')[1],
    send: jest.fn().mockResolvedValue({ id: 'dm-message-123' }),
  };

  // Create mock channel with improved structure
  const mockChannel = {
    id: config.channelId,
    type: config.isDM ? 1 : 0, // Discord channel types: 1=DM, 0=Guild Text
    nsfw: config.isNSFW,
    isDMBased: jest.fn().mockReturnValue(config.isDM),
    isTextBased: jest.fn().mockReturnValue(true),
    send: jest.fn().mockImplementation(content => {
      return Promise.resolve({
        id: 'sent-message-123',
        content: typeof content === 'string' ? content : JSON.stringify(content),
      });
    }),
    sendTyping: jest.fn().mockResolvedValue(undefined),
    messages: {
      fetch: jest.fn().mockResolvedValue({
        id: 'fetched-message-123',
        content: 'Fetched message content',
      }),
    },
  };

  // Create permissions with specified permissions
  const mockPermissions = {
    has: jest.fn().mockImplementation(permission => {
      if (permission === 'ADMINISTRATOR') return config.isAdmin;
      if (permission === 'MANAGE_MESSAGES') return config.canManageMessages;
      if (permission === 'ViewChannel') return true;
      return false;
    }),
  };

  // Create mock guild (only for non-DM channels)
  const mockGuild = config.isDM
    ? null
    : {
        id: config.guildId,
        channels: {
          cache: new Map([[config.channelId, mockChannel]]),
          fetch: jest.fn().mockResolvedValue(mockChannel),
        },
      };

  // Create mock member with permissions (only for guild channels)
  const mockMember = config.isDM
    ? null
    : {
        permissions: mockPermissions,
        id: config.authorId,
        guild: mockGuild,
      };

  // Set up channel permissions method
  mockChannel.permissionsFor = jest.fn().mockReturnValue(mockPermissions);

  // Create mock message
  const mockMessage = {
    id: config.id,
    content: config.content || '',
    author: mockAuthor,
    channel: mockChannel,
    member: mockMember,
    guild: mockGuild,
    webhookId: null,
    reference: null,
    reply: jest.fn().mockImplementation(content => {
      if (config.replyContent) {
        return Promise.resolve({
          id: 'reply-123',
          content: config.replyContent,
        });
      }
      return Promise.resolve({
        id: 'reply-123',
        content: typeof content === 'string' ? content : JSON.stringify(content),
      });
    }),
    delete: jest.fn().mockResolvedValue(true),
  };

  return mockMessage;
}

/**
 * Creates a direct send function for testing
 * @param {Object} mockMessage - Mock message object
 * @returns {Function} Direct send function
 */
function createDirectSend(mockMessage) {
  return jest.fn().mockImplementation(content => {
    return Promise.resolve({
      id: 'direct-sent-123',
      content: typeof content === 'string' ? content : JSON.stringify(content),
    });
  });
}

/**
 * Mocks the validator module for testing
 * @param {Object} options - Configuration options
 * @returns {Object} Mocked validator module
 */
function mockValidator(options = {}) {
  const defaults = {
    isAdmin: false,
    canManageMessages: false,
    isNsfwChannel: false,
  };

  const config = { ...defaults, ...options };

  return {
    isAdmin: jest.fn().mockReturnValue(config.isAdmin),
    canManageMessages: jest.fn().mockReturnValue(config.canManageMessages),
    isNsfwChannel: jest.fn().mockReturnValue(config.isNsfwChannel),
    createDirectSend: jest.fn().mockImplementation(mockMessage => {
      return createDirectSend(mockMessage);
    }),
    getPermissionErrorMessage: jest.fn().mockReturnValue('Permission error message'),
  };
}

/**
 * Verifies a standard success response from a command
 * @param {Function} mockDirectSend - The mocked direct send function
 * @param {Object} options - Options for verification
 * @param {boolean} options.isEmbed - Whether to expect an embed
 * @param {string} options.title - Expected title for embed response
 * @param {string} options.contains - Text that should be contained in the response
 */
function verifySuccessResponse(mockDirectSend, options = {}) {
  const defaults = {
    isEmbed: false,
    title: null,
    contains: null,
  };

  const config = { ...defaults, ...options };

  // Basic verification that directSend was called
  expect(mockDirectSend).toHaveBeenCalled();

  // Get call arguments
  const callArgs = mockDirectSend.mock.calls[0][0];

  // Check if this is an embed or text response
  if (config.isEmbed) {
    expect(callArgs).toHaveProperty('embeds');
    expect(callArgs.embeds[0]).toBeDefined();

    if (config.title) {
      const embed = callArgs.embeds[0];
      if (typeof embed.toJSON === 'function') {
        const embeddedJson = embed.toJSON();
        expect(embeddedJson.title).toBe(config.title);
      } else {
        expect(embed.title).toBe(config.title);
      }
    }
  } else if (config.contains) {
    // For text responses, check that it contains expected text
    expect(callArgs).toContain(config.contains);
  }
}

/**
 * Verifies an error response from a command
 * @param {Function} mockDirectSend - The mocked direct send function
 * @param {Object} options - Options for verification
 * @param {string} options.contains - Text that should be contained in the error
 */
function verifyErrorResponse(mockDirectSend, options = {}) {
  const defaults = {
    contains: 'error',
  };

  const config = { ...defaults, ...options };

  // Basic verification that directSend was called
  expect(mockDirectSend).toHaveBeenCalled();

  // Get call arguments
  const callArgs = mockDirectSend.mock.calls[0][0];

  // Check if the error message contains expected text
  if (typeof callArgs === 'string') {
    expect(callArgs.toLowerCase()).toContain(config.contains.toLowerCase());
  } else {
    // If it's an object (like an embed), check its string representation
    expect(JSON.stringify(callArgs).toLowerCase()).toContain(config.contains.toLowerCase());
  }
}

module.exports = {
  createMockMessage,
  createDirectSend,
  mockValidator,
  verifySuccessResponse,
  verifyErrorResponse,
};
