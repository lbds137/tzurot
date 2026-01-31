/**
 * @jest-environment node
 * @testType domain
 *
 * PersonalityConfiguration Value Object Test
 * - Tests personality configuration value object
 * - Pure domain test with no external dependencies
 * - Tests value object immutability and validation
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const {
  PersonalityConfiguration,
} = require('../../../../src/domain/personality/PersonalityConfiguration');

describe('PersonalityConfiguration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create valid configuration', () => {
      const config = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      expect(config.name).toBe('test-personality');
      expect(config.prompt).toBe('You are a helpful assistant');
      expect(config.modelPath).toBe('/models/gpt-4');
      expect(config.maxWordCount).toBe(2000);
      expect(config.disableContextMetadata).toBe(false);
    });

    it('should use default maxWordCount', () => {
      const config = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4'
      );

      expect(config.maxWordCount).toBe(1000);
      expect(config.disableContextMetadata).toBe(false);
    });

    it('should reject missing name', () => {
      expect(
        () => new PersonalityConfiguration(null, 'You are a helpful assistant', '/models/gpt-4')
      ).toThrow('Name is required and must be a string');
    });

    it('should reject empty name', () => {
      expect(
        () => new PersonalityConfiguration('', 'You are a helpful assistant', '/models/gpt-4')
      ).toThrow('Name is required and must be a string');
    });

    it('should reject non-string name', () => {
      expect(
        () => new PersonalityConfiguration(123, 'You are a helpful assistant', '/models/gpt-4')
      ).toThrow('Name is required and must be a string');
    });

    it('should reject missing prompt', () => {
      expect(() => new PersonalityConfiguration('test-personality', null, '/models/gpt-4')).toThrow(
        'Prompt is required and must be a string'
      );
    });

    it('should reject empty prompt', () => {
      expect(() => new PersonalityConfiguration('test-personality', '', '/models/gpt-4')).toThrow(
        'Prompt is required and must be a string'
      );
    });

    it('should reject non-string prompt', () => {
      expect(() => new PersonalityConfiguration('test-personality', 123, '/models/gpt-4')).toThrow(
        'Prompt is required and must be a string'
      );
    });

    it('should reject missing modelPath', () => {
      expect(
        () => new PersonalityConfiguration('test-personality', 'You are a helpful assistant', null)
      ).toThrow('Model path is required and must be a string');
    });

    it('should reject empty modelPath', () => {
      expect(
        () => new PersonalityConfiguration('test-personality', 'You are a helpful assistant', '')
      ).toThrow('Model path is required and must be a string');
    });

    it('should reject non-string modelPath', () => {
      expect(
        () => new PersonalityConfiguration('test-personality', 'You are a helpful assistant', 123)
      ).toThrow('Model path is required and must be a string');
    });

    it('should reject zero maxWordCount', () => {
      expect(
        () =>
          new PersonalityConfiguration(
            'test-personality',
            'You are a helpful assistant',
            '/models/gpt-4',
            0
          )
      ).toThrow('Max word count must be a positive number');
    });

    it('should reject negative maxWordCount', () => {
      expect(
        () =>
          new PersonalityConfiguration(
            'test-personality',
            'You are a helpful assistant',
            '/models/gpt-4',
            -100
          )
      ).toThrow('Max word count must be a positive number');
    });

    it('should reject non-number maxWordCount', () => {
      expect(
        () =>
          new PersonalityConfiguration(
            'test-personality',
            'You are a helpful assistant',
            '/models/gpt-4',
            'thousand'
          )
      ).toThrow('Max word count must be a positive number');
    });
  });

  describe('withUpdates', () => {
    let config;

    beforeEach(() => {
      config = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );
    });

    it('should create new configuration with updated prompt', () => {
      const updated = config.withUpdates({
        prompt: 'You are a creative writer',
      });

      expect(updated).not.toBe(config); // Different instances
      expect(updated.name).toBe('test-personality'); // Name unchanged
      expect(updated.prompt).toBe('You are a creative writer'); // Updated
      expect(updated.modelPath).toBe('/models/gpt-4'); // Unchanged
      expect(updated.maxWordCount).toBe(2000); // Unchanged
      expect(updated.disableContextMetadata).toBe(false); // Unchanged
    });

    it('should create new configuration with updated modelPath', () => {
      const updated = config.withUpdates({
        modelPath: '/models/claude-3',
      });

      expect(updated).not.toBe(config);
      expect(updated.name).toBe('test-personality');
      expect(updated.prompt).toBe('You are a helpful assistant');
      expect(updated.modelPath).toBe('/models/claude-3');
      expect(updated.maxWordCount).toBe(2000);
      expect(updated.disableContextMetadata).toBe(false);
    });

    it('should create new configuration with updated maxWordCount', () => {
      const updated = config.withUpdates({
        maxWordCount: 5000,
      });

      expect(updated).not.toBe(config);
      expect(updated.name).toBe('test-personality');
      expect(updated.prompt).toBe('You are a helpful assistant');
      expect(updated.modelPath).toBe('/models/gpt-4');
      expect(updated.maxWordCount).toBe(5000);
      expect(updated.disableContextMetadata).toBe(false);
    });

    it('should create new configuration with multiple updates', () => {
      const updated = config.withUpdates({
        prompt: 'You are a creative writer',
        modelPath: '/models/claude-3',
        maxWordCount: 3000,
      });

      expect(updated).not.toBe(config);
      expect(updated.name).toBe('test-personality'); // Name never changes
      expect(updated.prompt).toBe('You are a creative writer');
      expect(updated.modelPath).toBe('/models/claude-3');
      expect(updated.maxWordCount).toBe(3000);
      expect(updated.disableContextMetadata).toBe(false);
    });

    it('should not change name even if provided', () => {
      const updated = config.withUpdates({
        name: 'new-name', // Should be ignored
        prompt: 'You are a creative writer',
      });

      expect(updated.name).toBe('test-personality'); // Original name
    });

    it('should create new configuration with updated disableContextMetadata', () => {
      const updated = config.withUpdates({
        disableContextMetadata: true,
      });

      expect(updated).not.toBe(config);
      expect(updated.name).toBe('test-personality');
      expect(updated.prompt).toBe('You are a helpful assistant');
      expect(updated.modelPath).toBe('/models/gpt-4');
      expect(updated.maxWordCount).toBe(2000);
      expect(updated.disableContextMetadata).toBe(true);
    });

    it('should handle empty updates object', () => {
      const updated = config.withUpdates({});

      expect(updated).not.toBe(config); // Still creates new instance
      expect(updated.name).toBe(config.name);
      expect(updated.prompt).toBe(config.prompt);
      expect(updated.modelPath).toBe(config.modelPath);
      expect(updated.maxWordCount).toBe(config.maxWordCount);
      expect(updated.disableContextMetadata).toBe(config.disableContextMetadata);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const config = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      const json = config.toJSON();

      expect(json).toEqual({
        name: 'test-personality',
        prompt: 'You are a helpful assistant',
        modelPath: '/models/gpt-4',
        maxWordCount: 2000,
        disableContextMetadata: false,
      });
    });
  });

  describe('fromJSON', () => {
    it('should create from JSON', () => {
      const json = {
        name: 'test-personality',
        prompt: 'You are a helpful assistant',
        modelPath: '/models/gpt-4',
        maxWordCount: 2000,
        disableContextMetadata: true,
      };

      const config = PersonalityConfiguration.fromJSON(json);

      expect(config).toBeInstanceOf(PersonalityConfiguration);
      expect(config.name).toBe('test-personality');
      expect(config.prompt).toBe('You are a helpful assistant');
      expect(config.modelPath).toBe('/models/gpt-4');
      expect(config.maxWordCount).toBe(2000);
      expect(config.disableContextMetadata).toBe(true);
    });

    it('should apply validation when creating from JSON', () => {
      const invalidJson = {
        name: '',
        prompt: 'You are a helpful assistant',
        modelPath: '/models/gpt-4',
        maxWordCount: 2000,
      };

      expect(() => PersonalityConfiguration.fromJSON(invalidJson)).toThrow(
        'Name is required and must be a string'
      );
    });
  });

  describe('value object immutability', () => {
    it('should be frozen after construction', () => {
      const config = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      expect(Object.isFrozen(config)).toBe(true);

      // Attempting to modify should throw in strict mode
      expect(() => {
        config.name = 'modified-name';
      }).toThrow();
    });
  });

  describe('value object equality', () => {
    it('should be equal for same values', () => {
      const config1 = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      const config2 = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      expect(config1.equals(config2)).toBe(true);
      expect(config2.equals(config1)).toBe(true);
    });

    it('should not be equal for different names', () => {
      const config1 = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      const config2 = new PersonalityConfiguration(
        'other-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      expect(config1.equals(config2)).toBe(false);
    });

    it('should not be equal for different prompts', () => {
      const config1 = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      const config2 = new PersonalityConfiguration(
        'test-personality',
        'You are a creative writer',
        '/models/gpt-4',
        2000
      );

      expect(config1.equals(config2)).toBe(false);
    });

    it('should not be equal for different modelPaths', () => {
      const config1 = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      const config2 = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/claude-3',
        2000
      );

      expect(config1.equals(config2)).toBe(false);
    });

    it('should not be equal for different maxWordCounts', () => {
      const config1 = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        2000
      );

      const config2 = new PersonalityConfiguration(
        'test-personality',
        'You are a helpful assistant',
        '/models/gpt-4',
        3000
      );

      expect(config1.equals(config2)).toBe(false);
    });
  });
});
