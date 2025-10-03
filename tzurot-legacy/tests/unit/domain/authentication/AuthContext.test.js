/**
 * @jest-environment node
 * @testType domain
 *
 * AuthContext Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests authentication context for different channel types
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { AuthContext } = require('../../../../src/domain/authentication/AuthContext');

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create context with all properties', () => {
      const context = new AuthContext({
        channelType: 'GUILD',
        channelId: '123456789012345678',
        isNsfwChannel: true,
        isProxyMessage: true,
        requestedPersonalityId: 'claude-3-opus',
      });

      expect(context.channelType).toBe('GUILD');
      expect(context.channelId).toBe('123456789012345678');
      expect(context.isNsfwChannel).toBe(true);
      expect(context.isProxyMessage).toBe(true);
      expect(context.requestedPersonalityId).toBe('claude-3-opus');
    });

    it('should default optional properties', () => {
      const context = new AuthContext({
        channelType: 'DM',
        channelId: '123456789012345678',
      });

      expect(context.isNsfwChannel).toBe(false);
      expect(context.isProxyMessage).toBe(false);
      expect(context.requestedPersonalityId).toBeNull();
    });

    it('should coerce boolean properties', () => {
      const context = new AuthContext({
        channelType: 'GUILD',
        channelId: '123456789012345678',
        isNsfwChannel: 'truthy',
        isProxyMessage: 1,
      });

      expect(context.isNsfwChannel).toBe(true);
      expect(context.isProxyMessage).toBe(true);
    });
  });

  describe('validation', () => {
    it('should require valid channel type', () => {
      expect(
        () =>
          new AuthContext({
            channelType: 'INVALID',
            channelId: '123456789012345678',
          })
      ).toThrow('Invalid channel type');

      expect(
        () =>
          new AuthContext({
            channelType: null,
            channelId: '123456789012345678',
          })
      ).toThrow('Invalid channel type');

      expect(
        () =>
          new AuthContext({
            channelId: '123456789012345678',
          })
      ).toThrow('Invalid channel type');
    });

    it('should accept valid channel types', () => {
      const dmContext = new AuthContext({
        channelType: 'DM',
        channelId: '123456789012345678',
      });

      const guildContext = new AuthContext({
        channelType: 'GUILD',
        channelId: '123456789012345678',
      });

      const threadContext = new AuthContext({
        channelType: 'THREAD',
        channelId: '123456789012345678',
      });

      expect(dmContext.channelType).toBe('DM');
      expect(guildContext.channelType).toBe('GUILD');
      expect(threadContext.channelType).toBe('THREAD');
    });

    it('should require channel ID', () => {
      expect(
        () =>
          new AuthContext({
            channelType: 'GUILD',
            channelId: null,
          })
      ).toThrow('Channel ID required');

      expect(
        () =>
          new AuthContext({
            channelType: 'GUILD',
            channelId: '',
          })
      ).toThrow('Channel ID required');

      expect(
        () =>
          new AuthContext({
            channelType: 'GUILD',
          })
      ).toThrow('Channel ID required');
    });

    it('should require channel ID to be string', () => {
      expect(
        () =>
          new AuthContext({
            channelType: 'GUILD',
            channelId: 123456789012345,
          })
      ).toThrow('Channel ID required');
    });
  });

  describe('isDM', () => {
    it('should return true for DM context', () => {
      const context = AuthContext.createForDM('123456789012345678');

      expect(context.isDM()).toBe(true);
    });

    it('should return false for guild context', () => {
      const context = AuthContext.createForGuild('123456789012345678');

      expect(context.isDM()).toBe(false);
    });

    it('should return false for thread context', () => {
      const context = AuthContext.createForThread('123456789012345678');

      expect(context.isDM()).toBe(false);
    });
  });

  describe('isGuildChannel', () => {
    it('should return true for guild context', () => {
      const context = AuthContext.createForGuild('123456789012345678');

      expect(context.isGuildChannel()).toBe(true);
    });

    it('should return false for DM context', () => {
      const context = AuthContext.createForDM('123456789012345678');

      expect(context.isGuildChannel()).toBe(false);
    });

    it('should return false for thread context', () => {
      const context = AuthContext.createForThread('123456789012345678');

      expect(context.isGuildChannel()).toBe(false);
    });
  });

  describe('isThread', () => {
    it('should return true for thread context', () => {
      const context = AuthContext.createForThread('123456789012345678');

      expect(context.isThread()).toBe(true);
    });

    it('should return false for DM context', () => {
      const context = AuthContext.createForDM('123456789012345678');

      expect(context.isThread()).toBe(false);
    });

    it('should return false for guild context', () => {
      const context = AuthContext.createForGuild('123456789012345678');

      expect(context.isThread()).toBe(false);
    });
  });

  describe('requiresNsfwVerification', () => {
    it('should return false for DMs', () => {
      const context = AuthContext.createForDM('123456789012345678');

      expect(context.requiresNsfwVerification()).toBe(false);
    });

    it('should return false for non-NSFW guild channels', () => {
      const context = AuthContext.createForGuild('123456789012345678', false);

      expect(context.requiresNsfwVerification()).toBe(false);
    });

    it('should return true for NSFW guild channels', () => {
      const context = AuthContext.createForGuild('123456789012345678', true);

      expect(context.requiresNsfwVerification()).toBe(true);
    });

    it('should return true for threads in NSFW channels', () => {
      const context = AuthContext.createForThread('123456789012345678', true);

      expect(context.requiresNsfwVerification()).toBe(true);
    });

    it('should return false for threads in non-NSFW channels', () => {
      const context = AuthContext.createForThread('123456789012345678', false);

      expect(context.requiresNsfwVerification()).toBe(false);
    });
  });

  describe('allowsProxy', () => {
    it('should return false for DMs', () => {
      const context = AuthContext.createForDM('123456789012345678');

      expect(context.allowsProxy()).toBe(false);
    });

    it('should return true for guild channels', () => {
      const context = AuthContext.createForGuild('123456789012345678');

      expect(context.allowsProxy()).toBe(true);
    });

    it('should return true for threads', () => {
      const context = AuthContext.createForThread('123456789012345678');

      expect(context.allowsProxy()).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const context = new AuthContext({
        channelType: 'GUILD',
        channelId: '123456789012345678',
        isNsfwChannel: true,
        isProxyMessage: false,
        requestedPersonalityId: 'claude-3-opus',
      });

      const json = context.toJSON();

      expect(json).toEqual({
        channelType: 'GUILD',
        channelId: '123456789012345678',
        isNsfwChannel: true,
        isProxyMessage: false,
        requestedPersonalityId: 'claude-3-opus',
      });
    });
  });

  describe('createForDM', () => {
    it('should create DM context', () => {
      const context = AuthContext.createForDM('123456789012345678');

      expect(context.channelType).toBe('DM');
      expect(context.channelId).toBe('123456789012345678');
      expect(context.isNsfwChannel).toBe(false);
      expect(context.isProxyMessage).toBe(false);
    });
  });

  describe('createForGuild', () => {
    it('should create guild context with defaults', () => {
      const context = AuthContext.createForGuild('123456789012345678');

      expect(context.channelType).toBe('GUILD');
      expect(context.channelId).toBe('123456789012345678');
      expect(context.isNsfwChannel).toBe(false);
      expect(context.isProxyMessage).toBe(false);
    });

    it('should create NSFW guild context', () => {
      const context = AuthContext.createForGuild('123456789012345678', true);

      expect(context.isNsfwChannel).toBe(true);
    });
  });

  describe('createForThread', () => {
    it('should create thread context with defaults', () => {
      const context = AuthContext.createForThread('123456789012345678');

      expect(context.channelType).toBe('THREAD');
      expect(context.channelId).toBe('123456789012345678');
      expect(context.isNsfwChannel).toBe(false);
      expect(context.isProxyMessage).toBe(false);
    });

    it('should inherit parent NSFW status', () => {
      const context = AuthContext.createForThread('123456789012345678', true);

      expect(context.isNsfwChannel).toBe(true);
    });
  });

  describe('immutability', () => {
    it('should not be affected by JSON modifications', () => {
      const context = AuthContext.createForGuild('123456789012345678', true);
      const json = context.toJSON();

      // Modify JSON
      json.channelType = 'DM';
      json.isNsfwChannel = false;

      // Original context unchanged
      expect(context.channelType).toBe('GUILD');
      expect(context.isNsfwChannel).toBe(true);
    });
  });
});
