/**
 * @jest-environment node
 * @testType domain
 *
 * AIModel Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests AI model configuration and capabilities
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const { AIModel } = require('../../../../src/domain/ai/AIModel');
const { AIContent } = require('../../../../src/domain/ai/AIContent');

describe('AIModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create model with name and path', () => {
      const model = new AIModel('gpt-4', 'gpt-4-1106-preview');

      expect(model.name).toBe('gpt-4');
      expect(model.path).toBe('gpt-4-1106-preview');
    });

    it('should set default capabilities', () => {
      const model = new AIModel('gpt-4', 'gpt-4-1106-preview');

      expect(model.capabilities).toEqual({
        supportsImages: false,
        supportsAudio: false,
        maxTokens: 4096,
        temperature: 0.7,
      });
    });

    it('should accept custom capabilities', () => {
      const model = new AIModel('claude-3', 'claude-3-opus', {
        supportsImages: true,
        supportsAudio: true,
        maxTokens: 8192,
        temperature: 0.9,
      });

      expect(model.capabilities).toEqual({
        supportsImages: true,
        supportsAudio: true,
        maxTokens: 8192,
        temperature: 0.9,
      });
    });

    it('should validate name', () => {
      expect(() => new AIModel(null, 'path')).toThrow('Model name required');
      expect(() => new AIModel('', 'path')).toThrow('Model name required');
      expect(() => new AIModel(123, 'path')).toThrow('Model name required');
    });

    it('should validate path', () => {
      expect(() => new AIModel('name', null)).toThrow('Model path required');
      expect(() => new AIModel('name', '')).toThrow('Model path required');
      expect(() => new AIModel('name', 123)).toThrow('Model path required');
    });
  });

  describe('supports', () => {
    let model;

    beforeEach(() => {
      model = new AIModel('test', 'test-path', {
        supportsImages: true,
        supportsAudio: false,
      });
    });

    it('should always support text', () => {
      expect(model.supports('text')).toBe(true);
    });

    it('should check image support', () => {
      expect(model.supports('image')).toBe(true);
    });

    it('should check audio support', () => {
      expect(model.supports('audio')).toBe(false);
    });

    it('should return false for unknown types', () => {
      expect(model.supports('video')).toBe(false);
    });
  });

  describe('isCompatibleWith', () => {
    let textModel;
    let multimodalModel;

    beforeEach(() => {
      textModel = new AIModel('text-only', 'gpt-3.5', {
        supportsImages: false,
        supportsAudio: false,
      });

      multimodalModel = new AIModel('multimodal', 'claude-3', {
        supportsImages: true,
        supportsAudio: true,
      });
    });

    it('should accept text content for text-only model', () => {
      const content = AIContent.fromText('Hello');

      expect(textModel.isCompatibleWith(content)).toBe(true);
    });

    it('should reject image content for text-only model', () => {
      const content = new AIContent([
        { type: 'text', text: 'Check this' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ]);

      expect(textModel.isCompatibleWith(content)).toBe(false);
    });

    it('should reject audio content for text-only model', () => {
      const content = new AIContent([
        { type: 'text', text: 'Listen' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ]);

      expect(textModel.isCompatibleWith(content)).toBe(false);
    });

    it('should accept all content for multimodal model', () => {
      const content = new AIContent([
        { type: 'text', text: 'Multi' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ]);

      expect(multimodalModel.isCompatibleWith(content)).toBe(true);
    });

    it('should handle null content', () => {
      expect(textModel.isCompatibleWith(null)).toBe(true);
    });

    it('should handle content without items', () => {
      expect(textModel.isCompatibleWith({})).toBe(true);
    });
  });

  describe('getParameters', () => {
    it('should return model parameters', () => {
      const model = new AIModel('test', 'test-path', {
        maxTokens: 2048,
        temperature: 0.5,
      });

      expect(model.getParameters()).toEqual({
        model: 'test-path',
        max_tokens: 2048,
        temperature: 0.5,
      });
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const model = new AIModel('test', 'test-path', {
        supportsImages: true,
        supportsAudio: false,
        maxTokens: 2048,
        temperature: 0.5,
      });

      expect(model.toJSON()).toEqual({
        name: 'test',
        path: 'test-path',
        capabilities: {
          supportsImages: true,
          supportsAudio: false,
          maxTokens: 2048,
          temperature: 0.5,
        },
      });
    });
  });

  describe('createDefault', () => {
    it('should create default Claude model', () => {
      const model = AIModel.createDefault();

      expect(model.name).toBe('default');
      expect(model.path).toBe('claude-3-opus-20240229');
      expect(model.capabilities).toEqual({
        supportsImages: true,
        supportsAudio: true,
        maxTokens: 4096,
        temperature: 0.7,
      });
    });
  });

  describe('equals', () => {
    it('should compare models by name and path', () => {
      const model1 = new AIModel('test', 'test-path');
      const model2 = new AIModel('test', 'test-path');
      const model3 = new AIModel('other', 'other-path');

      expect(model1.equals(model2)).toBe(true);
      expect(model1.equals(model3)).toBe(false);
    });

    it('should compare capabilities', () => {
      const model1 = new AIModel('test', 'test-path', { supportsImages: true });
      const model2 = new AIModel('test', 'test-path', { supportsImages: false });

      expect(model1.equals(model2)).toBe(false);
    });

    it('should handle null comparison', () => {
      const model = new AIModel('test', 'test-path');

      expect(model.equals(null)).toBe(false);
    });
  });

  describe('immutability', () => {
    it('should not allow name modification', () => {
      const model = new AIModel('test', 'test-path');

      expect(() => {
        model.name = 'modified';
      }).toThrow();
    });

    it('should not allow path modification', () => {
      const model = new AIModel('test', 'test-path');

      expect(() => {
        model.path = 'modified';
      }).toThrow();
    });

    it('should not allow capabilities modification', () => {
      const model = new AIModel('test', 'test-path');

      expect(() => {
        model.capabilities = {};
      }).toThrow();
    });
  });
});
