/**
 * @jest-environment node
 * @testType domain
 *
 * ConversationSettings Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests conversation settings configuration
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const {
  ConversationSettings,
} = require('../../../../src/domain/conversation/ConversationSettings');

describe('ConversationSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const settings = new ConversationSettings();

      expect(settings.autoResponseEnabled).toBe(false);
      expect(settings.autoResponseDelay).toBe(8000);
      expect(settings.mentionOnly).toBe(false);
      expect(settings.timeoutMs).toBe(600000);
    });

    it('should create with custom values', () => {
      const settings = new ConversationSettings({
        autoResponseEnabled: true,
        autoResponseDelay: 5000,
        mentionOnly: true,
        timeoutMs: 300000,
      });

      expect(settings.autoResponseEnabled).toBe(true);
      expect(settings.autoResponseDelay).toBe(5000);
      expect(settings.mentionOnly).toBe(true);
      expect(settings.timeoutMs).toBe(300000);
    });

    it('should accept partial custom values', () => {
      const settings = new ConversationSettings({
        autoResponseEnabled: true,
        mentionOnly: true,
      });

      expect(settings.autoResponseEnabled).toBe(true);
      expect(settings.autoResponseDelay).toBe(8000); // default
      expect(settings.mentionOnly).toBe(true);
      expect(settings.timeoutMs).toBe(600000); // default
    });
  });

  describe('validation', () => {
    it('should validate autoResponseEnabled as boolean', () => {
      expect(
        () =>
          new ConversationSettings({
            autoResponseEnabled: 'true',
          })
      ).toThrow('autoResponseEnabled must be boolean');

      expect(
        () =>
          new ConversationSettings({
            autoResponseEnabled: 1,
          })
      ).toThrow('autoResponseEnabled must be boolean');
    });

    it('should validate autoResponseDelay as non-negative number', () => {
      expect(
        () =>
          new ConversationSettings({
            autoResponseDelay: '1000',
          })
      ).toThrow('autoResponseDelay must be non-negative number');

      expect(
        () =>
          new ConversationSettings({
            autoResponseDelay: -1,
          })
      ).toThrow('autoResponseDelay must be non-negative number');
    });

    it('should validate mentionOnly as boolean', () => {
      expect(
        () =>
          new ConversationSettings({
            mentionOnly: 'false',
          })
      ).toThrow('mentionOnly must be boolean');

      expect(
        () =>
          new ConversationSettings({
            mentionOnly: 0,
          })
      ).toThrow('mentionOnly must be boolean');
    });

    it('should validate timeoutMs as non-negative number', () => {
      expect(
        () =>
          new ConversationSettings({
            timeoutMs: '300000',
          })
      ).toThrow('timeoutMs must be non-negative number');

      expect(
        () =>
          new ConversationSettings({
            timeoutMs: -1000,
          })
      ).toThrow('timeoutMs must be non-negative number');
    });

    it('should allow zero values for numeric fields', () => {
      const settings = new ConversationSettings({
        autoResponseDelay: 0,
        timeoutMs: 0,
      });

      expect(settings.autoResponseDelay).toBe(0);
      expect(settings.timeoutMs).toBe(0);
    });
  });

  describe('withAutoResponse', () => {
    it('should create new settings with updated autoResponseEnabled', () => {
      const settings = new ConversationSettings();

      const updated = settings.withAutoResponse(true);

      expect(updated).not.toBe(settings); // new instance
      expect(updated.autoResponseEnabled).toBe(true);
      expect(updated.autoResponseDelay).toBe(settings.autoResponseDelay);
      expect(updated.mentionOnly).toBe(settings.mentionOnly);
      expect(updated.timeoutMs).toBe(settings.timeoutMs);
    });

    it('should preserve immutability', () => {
      const settings = new ConversationSettings();

      settings.withAutoResponse(true);

      expect(settings.autoResponseEnabled).toBe(false); // unchanged
    });
  });

  describe('withAutoResponseDelay', () => {
    it('should create new settings with updated delay', () => {
      const settings = new ConversationSettings();

      const updated = settings.withAutoResponseDelay(5000);

      expect(updated).not.toBe(settings); // new instance
      expect(updated.autoResponseDelay).toBe(5000);
      expect(updated.autoResponseEnabled).toBe(settings.autoResponseEnabled);
      expect(updated.mentionOnly).toBe(settings.mentionOnly);
      expect(updated.timeoutMs).toBe(settings.timeoutMs);
    });

    it('should validate new delay', () => {
      const settings = new ConversationSettings();

      expect(() => settings.withAutoResponseDelay(-1)).toThrow(
        'autoResponseDelay must be non-negative number'
      );
    });
  });

  describe('withMentionOnly', () => {
    it('should create new settings with updated mentionOnly', () => {
      const settings = new ConversationSettings();

      const updated = settings.withMentionOnly(true);

      expect(updated).not.toBe(settings); // new instance
      expect(updated.mentionOnly).toBe(true);
      expect(updated.autoResponseEnabled).toBe(settings.autoResponseEnabled);
      expect(updated.autoResponseDelay).toBe(settings.autoResponseDelay);
      expect(updated.timeoutMs).toBe(settings.timeoutMs);
    });
  });

  describe('withTimeout', () => {
    it('should create new settings with updated timeout', () => {
      const settings = new ConversationSettings();

      const updated = settings.withTimeout(300000);

      expect(updated).not.toBe(settings); // new instance
      expect(updated.timeoutMs).toBe(300000);
      expect(updated.autoResponseEnabled).toBe(settings.autoResponseEnabled);
      expect(updated.autoResponseDelay).toBe(settings.autoResponseDelay);
      expect(updated.mentionOnly).toBe(settings.mentionOnly);
    });

    it('should validate new timeout', () => {
      const settings = new ConversationSettings();

      expect(() => settings.withTimeout(-1)).toThrow('timeoutMs must be non-negative number');
    });
  });

  describe('toJSON', () => {
    it('should return JSON representation', () => {
      const settings = new ConversationSettings({
        autoResponseEnabled: true,
        autoResponseDelay: 5000,
        mentionOnly: true,
        timeoutMs: 300000,
      });

      const json = settings.toJSON();

      expect(json).toEqual({
        autoResponseEnabled: true,
        autoResponseDelay: 5000,
        mentionOnly: true,
        timeoutMs: 300000,
      });
    });
  });

  describe('equals', () => {
    it('should return true for equal settings', () => {
      const settings1 = new ConversationSettings({
        autoResponseEnabled: true,
        autoResponseDelay: 5000,
        mentionOnly: true,
        timeoutMs: 300000,
      });

      const settings2 = new ConversationSettings({
        autoResponseEnabled: true,
        autoResponseDelay: 5000,
        mentionOnly: true,
        timeoutMs: 300000,
      });

      expect(settings1.equals(settings2)).toBe(true);
      expect(settings2.equals(settings1)).toBe(true);
    });

    it('should return false for different settings', () => {
      const settings1 = new ConversationSettings();
      const settings2 = settings1.withAutoResponse(true);

      expect(settings1.equals(settings2)).toBe(false);
    });

    it('should handle self-comparison', () => {
      const settings = new ConversationSettings();

      expect(settings.equals(settings)).toBe(true);
    });
  });

  describe('createDefault', () => {
    it('should create settings with default values', () => {
      const settings = ConversationSettings.createDefault();

      expect(settings.autoResponseEnabled).toBe(false);
      expect(settings.autoResponseDelay).toBe(8000);
      expect(settings.mentionOnly).toBe(false);
      expect(settings.timeoutMs).toBe(600000);
    });
  });

  describe('createForDM', () => {
    it('should create settings optimized for DM', () => {
      const settings = ConversationSettings.createForDM();

      expect(settings.autoResponseEnabled).toBe(true);
      expect(settings.autoResponseDelay).toBe(8000);
      expect(settings.mentionOnly).toBe(false);
      expect(settings.timeoutMs).toBe(600000);
    });
  });

  describe('immutability', () => {
    it('should not be affected by JSON modifications', () => {
      const settings = new ConversationSettings({
        autoResponseEnabled: true,
        autoResponseDelay: 5000,
      });
      const json = settings.toJSON();

      // Modify JSON
      json.autoResponseEnabled = false;
      json.autoResponseDelay = 10000;

      // Original settings unchanged
      expect(settings.autoResponseEnabled).toBe(true);
      expect(settings.autoResponseDelay).toBe(5000);
    });
  });
});
