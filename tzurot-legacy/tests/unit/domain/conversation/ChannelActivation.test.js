/**
 * @jest-environment node
 * @testType domain
 *
 * ChannelActivation Test
 * - Pure domain test with no external dependencies
 * - Tests channel activation aggregate
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const { ChannelActivation } = require('../../../../src/domain/conversation/ChannelActivation');
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');
const { UserId } = require('../../../../src/domain/personality/UserId');

describe('ChannelActivation', () => {
  let validChannelId;
  let validPersonalityId;
  let validUserId;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    validChannelId = '123456789012345678';
    validPersonalityId = new PersonalityId('test-personality');
    validUserId = new UserId('987654321098765432');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create valid channel activation', () => {
      const activation = new ChannelActivation(validChannelId, validPersonalityId, validUserId);

      expect(activation.channelId).toBe(validChannelId);
      expect(activation.personalityId).toBe(validPersonalityId);
      expect(activation.activatedBy).toBe(validUserId);
      expect(activation.activatedAt).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(activation.active).toBe(true);
      expect(activation.id).toBe(validChannelId);
    });

    it('should require valid channelId', () => {
      expect(() => new ChannelActivation('', validPersonalityId, validUserId)).toThrow(
        'ChannelActivation requires valid channelId'
      );

      expect(() => new ChannelActivation(null, validPersonalityId, validUserId)).toThrow(
        'ChannelActivation requires valid channelId'
      );

      expect(() => new ChannelActivation(123, validPersonalityId, validUserId)).toThrow(
        'ChannelActivation requires valid channelId'
      );
    });
  });

  describe('create static method', () => {
    it('should create valid activation with factory method', () => {
      const activation = ChannelActivation.create(validChannelId, validPersonalityId, validUserId);

      expect(activation).toBeInstanceOf(ChannelActivation);
      expect(activation.channelId).toBe(validChannelId);
      expect(activation.personalityId).toBe(validPersonalityId);
      expect(activation.activatedBy).toBe(validUserId);
      expect(activation.active).toBe(true);
    });

    it('should require valid PersonalityId', () => {
      expect(() => ChannelActivation.create(validChannelId, 'invalid', validUserId)).toThrow(
        'Invalid PersonalityId'
      );

      expect(() => ChannelActivation.create(validChannelId, null, validUserId)).toThrow(
        'Invalid PersonalityId'
      );
    });

    it('should require valid UserId', () => {
      expect(() => ChannelActivation.create(validChannelId, validPersonalityId, 'invalid')).toThrow(
        'Invalid UserId'
      );

      expect(() => ChannelActivation.create(validChannelId, validPersonalityId, null)).toThrow(
        'Invalid UserId'
      );
    });
  });

  describe('deactivate', () => {
    it('should deactivate active channel', () => {
      const activation = ChannelActivation.create(validChannelId, validPersonalityId, validUserId);
      const initialVersion = activation.version;

      activation.deactivate();

      expect(activation.active).toBe(false);
      expect(activation.version).toBe(initialVersion + 1);
    });

    it('should throw error when already deactivated', () => {
      const activation = ChannelActivation.create(validChannelId, validPersonalityId, validUserId);
      activation.deactivate();

      expect(() => activation.deactivate()).toThrow('Channel already deactivated');
    });
  });

  describe('isForPersonality', () => {
    it('should return true for matching personality', () => {
      const activation = ChannelActivation.create(validChannelId, validPersonalityId, validUserId);

      expect(activation.isForPersonality(validPersonalityId)).toBe(true);
    });

    it('should return false for different personality', () => {
      const activation = ChannelActivation.create(validChannelId, validPersonalityId, validUserId);
      const differentPersonality = new PersonalityId('different-personality');

      expect(activation.isForPersonality(differentPersonality)).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON correctly', () => {
      const activation = ChannelActivation.create(validChannelId, validPersonalityId, validUserId);

      const json = activation.toJSON();

      expect(json).toEqual({
        channelId: validChannelId,
        personalityId: 'test-personality',
        activatedBy: '987654321098765432',
        activatedAt: '2024-01-01T00:00:00.000Z',
        active: true,
      });
    });

    it('should serialize deactivated state correctly', () => {
      const activation = ChannelActivation.create(validChannelId, validPersonalityId, validUserId);
      activation.deactivate();

      const json = activation.toJSON();

      expect(json.active).toBe(false);
    });
  });

  describe('aggregate root behavior', () => {
    it('should extend AggregateRoot', () => {
      const activation = ChannelActivation.create(validChannelId, validPersonalityId, validUserId);

      expect(activation.version).toBeDefined();
      expect(typeof activation.version).toBe('number');
      expect(activation.id).toBe(validChannelId);
    });

    it('should increment version on state changes', () => {
      const activation = ChannelActivation.create(validChannelId, validPersonalityId, validUserId);
      const initialVersion = activation.version;

      activation.deactivate();

      expect(activation.version).toBe(initialVersion + 1);
    });
  });
});
