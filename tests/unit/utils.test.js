const utils = require('../../src/utils');
const logger = require('../../src/logger');

// Mock logger
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Configure utils to use Jest's fake timers
    utils.configureTimers({
      setTimeout: jest.fn().mockImplementation((fn, ms) => setTimeout(fn, ms)),
      clearTimeout: jest.fn().mockImplementation(id => clearTimeout(id)),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('validateAlias', () => {
    it('should return false for empty or null alias', () => {
      expect(utils.validateAlias('')).toBe(false);
      expect(utils.validateAlias(null)).toBe(false);
      expect(utils.validateAlias(undefined)).toBe(false);
    });

    it('should return false for aliases shorter than 2 characters', () => {
      expect(utils.validateAlias('a')).toBe(false);
      expect(utils.validateAlias('1')).toBe(false);
    });

    it('should return false for aliases with invalid characters', () => {
      expect(utils.validateAlias('hello world')).toBe(false); // space
      expect(utils.validateAlias('hello@world')).toBe(false); // @
      expect(utils.validateAlias('hello!world')).toBe(false); // !
      expect(utils.validateAlias('hello.world')).toBe(false); // .
    });

    it('should return true for valid aliases', () => {
      expect(utils.validateAlias('hello')).toBe(true);
      expect(utils.validateAlias('hello-world')).toBe(true);
      expect(utils.validateAlias('hello_world')).toBe(true);
      expect(utils.validateAlias('Hello123')).toBe(true);
      expect(utils.validateAlias('test-123_abc')).toBe(true);
      expect(utils.validateAlias('ab')).toBe(true); // exactly 2 chars
    });
  });

  describe('cleanupTimeout', () => {
    it('should remove item from Set after timeout', () => {
      const testSet = new Set(['item1', 'item2']);
      const timeout = utils.cleanupTimeout(testSet, 'item1', 1000, 'TestPrefix');

      expect(testSet.has('item1')).toBe(true);

      // Fast forward time
      jest.advanceTimersByTime(1000);

      expect(testSet.has('item1')).toBe(false);
      expect(testSet.has('item2')).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        '[TestPrefix] Removing item1 from collection after timeout'
      );
    });

    it('should remove item from Map after timeout', () => {
      const testMap = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ]);
      const timeout = utils.cleanupTimeout(testMap, 'key1', 2000, 'MapTest');

      expect(testMap.has('key1')).toBe(true);

      jest.advanceTimersByTime(2000);

      expect(testMap.has('key1')).toBe(false);
      expect(testMap.has('key2')).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        '[MapTest] Removing key1 from collection after timeout'
      );
    });

    it('should not log if item was already removed', () => {
      const testSet = new Set(['item1']);
      const timeout = utils.cleanupTimeout(testSet, 'item1', 1000, 'TestPrefix');

      // Remove item manually before timeout
      testSet.delete('item1');

      jest.advanceTimersByTime(1000);

      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should return timeout object that can be cleared', () => {
      const testSet = new Set(['item1']);
      const timeout = utils.cleanupTimeout(testSet, 'item1', 1000, 'TestPrefix');

      clearTimeout(timeout);
      jest.advanceTimersByTime(1000);

      expect(testSet.has('item1')).toBe(true);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('safeToLowerCase', () => {
    it('should return empty string for falsy values', () => {
      expect(utils.safeToLowerCase('')).toBe('');
      expect(utils.safeToLowerCase(null)).toBe('');
      expect(utils.safeToLowerCase(undefined)).toBe('');
      expect(utils.safeToLowerCase(0)).toBe(''); // 0 is falsy, returns empty string
      expect(utils.safeToLowerCase(false)).toBe(''); // false is falsy, returns empty string
    });

    it('should convert strings to lowercase', () => {
      expect(utils.safeToLowerCase('HELLO')).toBe('hello');
      expect(utils.safeToLowerCase('Hello World')).toBe('hello world');
      expect(utils.safeToLowerCase('MiXeD-CaSe_123')).toBe('mixed-case_123');
    });

    it('should handle non-string values by converting to string first', () => {
      expect(utils.safeToLowerCase(123)).toBe('123');
      expect(utils.safeToLowerCase(true)).toBe('true');
      expect(utils.safeToLowerCase({ toString: () => 'OBJECT' })).toBe('object');
    });
  });

  describe('createDirectSend', () => {
    let mockChannel;
    let mockMessage;

    beforeEach(() => {
      mockChannel = {
        send: jest.fn().mockResolvedValue({ id: 'sent-message-id' }),
      };
      mockMessage = {
        channel: mockChannel,
      };
    });

    it('should send string messages successfully', async () => {
      const sendFn = utils.createDirectSend(mockMessage);
      const result = await sendFn('Hello world');

      expect(mockChannel.send).toHaveBeenCalledWith('Hello world');
      expect(result).toEqual({ id: 'sent-message-id' });
    });

    it('should send object messages successfully', async () => {
      const sendFn = utils.createDirectSend(mockMessage);
      const embedObject = { embeds: [{ title: 'Test' }] };
      const result = await sendFn(embedObject);

      expect(mockChannel.send).toHaveBeenCalledWith(embedObject);
      expect(result).toEqual({ id: 'sent-message-id' });
    });

    it('should handle send errors gracefully', async () => {
      mockChannel.send.mockRejectedValue(new Error('Send failed'));
      const sendFn = utils.createDirectSend(mockMessage);
      const result = await sendFn('Test message');

      expect(mockChannel.send).toHaveBeenCalledWith('Test message');
      expect(logger.error).toHaveBeenCalledWith('Error sending message:', expect.any(Error));
      expect(result).toBeNull();
    });

    it('should handle various content types', async () => {
      const sendFn = utils.createDirectSend(mockMessage);

      // Test with different content types
      await sendFn({ content: 'Text with options', tts: true });
      expect(mockChannel.send).toHaveBeenCalledWith({ content: 'Text with options', tts: true });

      await sendFn({ files: ['attachment.png'] });
      expect(mockChannel.send).toHaveBeenCalledWith({ files: ['attachment.png'] });
    });
  });

  describe('getAllAliasesForPersonality', () => {
    it('should return empty array for invalid inputs', () => {
      const aliasMap = new Map([['alias1', 'personality1']]);

      expect(utils.getAllAliasesForPersonality(null, aliasMap)).toEqual([]);
      expect(utils.getAllAliasesForPersonality('', aliasMap)).toEqual([]);
      expect(utils.getAllAliasesForPersonality('personality1', null)).toEqual([]);
      expect(utils.getAllAliasesForPersonality(undefined, undefined)).toEqual([]);
    });

    it('should find all aliases for a personality', () => {
      const aliasMap = new Map([
        ['alias1', 'personality1'],
        ['alias2', 'personality2'],
        ['alias3', 'personality1'],
        ['alias4', 'personality1'],
        ['alias5', 'personality3'],
      ]);

      const aliases = utils.getAllAliasesForPersonality('personality1', aliasMap);
      expect(aliases).toEqual(['alias1', 'alias3', 'alias4']);
      expect(aliases).toHaveLength(3);
    });

    it('should return empty array if no aliases found', () => {
      const aliasMap = new Map([
        ['alias1', 'personality1'],
        ['alias2', 'personality2'],
      ]);

      const aliases = utils.getAllAliasesForPersonality('personality3', aliasMap);
      expect(aliases).toEqual([]);
    });

    it('should handle empty alias map', () => {
      const aliasMap = new Map();
      const aliases = utils.getAllAliasesForPersonality('personality1', aliasMap);
      expect(aliases).toEqual([]);
    });
  });
});
