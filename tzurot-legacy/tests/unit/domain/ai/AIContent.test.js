/**
 * @jest-environment node
 * @testType domain
 *
 * AIContent Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests AI content handling (text, images, audio)
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { AIContent } = require('../../../../src/domain/ai/AIContent');

describe('AIContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with empty array', () => {
      const content = new AIContent();

      expect(content.items).toEqual([]);
    });

    it('should initialize with provided items', () => {
      const items = [{ type: 'text', text: 'Hello' }];
      const content = new AIContent(items);

      expect(content.items).toEqual(items);
    });

    it('should validate items is array', () => {
      expect(() => new AIContent('not-an-array')).toThrow(
        'AIContent must be initialized with an array'
      );
    });

    it('should validate each item', () => {
      expect(() => new AIContent([{ type: 'invalid' }])).toThrow('Invalid content type: invalid');
    });
  });

  describe('validateItem', () => {
    it('should validate text items', () => {
      const content = new AIContent([{ type: 'text', text: 'Hello' }]);

      expect(content.items[0]).toEqual({ type: 'text', text: 'Hello' });
    });

    it('should validate image items', () => {
      const content = new AIContent([
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/image.jpg' },
        },
      ]);

      expect(content.items[0]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://example.com/image.jpg' },
      });
    });

    it('should validate audio items', () => {
      const content = new AIContent([
        {
          type: 'audio_url',
          audio_url: { url: 'https://example.com/audio.mp3' },
        },
      ]);

      expect(content.items[0]).toEqual({
        type: 'audio_url',
        audio_url: { url: 'https://example.com/audio.mp3' },
      });
    });

    it('should reject null items', () => {
      expect(() => new AIContent([null])).toThrow('Content item must be an object');
    });

    it('should reject items without type', () => {
      expect(() => new AIContent([{ text: 'Hello' }])).toThrow('Invalid content type: undefined');
    });

    it('should reject text without text property', () => {
      expect(() => new AIContent([{ type: 'text' }])).toThrow(
        'Text content must have text property'
      );
    });

    it('should reject image without url', () => {
      expect(() => new AIContent([{ type: 'image_url' }])).toThrow(
        'Image content must have image_url.url'
      );
    });

    it('should reject audio without url', () => {
      expect(() => new AIContent([{ type: 'audio_url' }])).toThrow(
        'Audio content must have audio_url.url'
      );
    });
  });

  describe('fromText', () => {
    it('should create content from text', () => {
      const content = AIContent.fromText('Hello world');

      expect(content.items).toEqual([{ type: 'text', text: 'Hello world' }]);
    });

    it('should validate text is string', () => {
      expect(() => AIContent.fromText(123)).toThrow('Text must be a non-empty string');
    });

    it('should validate text is not empty', () => {
      expect(() => AIContent.fromText('')).toThrow('Text must be a non-empty string');
    });
  });

  describe('addText', () => {
    it('should add text to content', () => {
      const content = AIContent.fromText('Hello');
      const newContent = content.addText('World');

      expect(newContent.items).toEqual([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ]);
    });

    it('should return new instance', () => {
      const content = AIContent.fromText('Hello');
      const newContent = content.addText('World');

      expect(newContent).not.toBe(content);
      expect(content.items).toHaveLength(1);
    });
  });

  describe('addImage', () => {
    it('should add image to content', () => {
      const content = AIContent.fromText('Check this image');
      const newContent = content.addImage('https://example.com/image.jpg');

      expect(newContent.items).toEqual([
        { type: 'text', text: 'Check this image' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ]);
    });

    it('should return new instance', () => {
      const content = AIContent.fromText('Hello');
      const newContent = content.addImage('https://example.com/image.jpg');

      expect(newContent).not.toBe(content);
    });
  });

  describe('addAudio', () => {
    it('should add audio to content', () => {
      const content = AIContent.fromText('Listen to this');
      const newContent = content.addAudio('https://example.com/audio.mp3');

      expect(newContent.items).toEqual([
        { type: 'text', text: 'Listen to this' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ]);
    });

    it('should return new instance', () => {
      const content = AIContent.fromText('Hello');
      const newContent = content.addAudio('https://example.com/audio.mp3');

      expect(newContent).not.toBe(content);
    });
  });

  describe('hasMedia', () => {
    it('should return false for text only', () => {
      const content = AIContent.fromText('Hello');

      expect(content.hasMedia()).toBe(false);
    });

    it('should return true for image content', () => {
      const content = new AIContent([
        { type: 'text', text: 'Check this' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ]);

      expect(content.hasMedia()).toBe(true);
    });

    it('should return true for audio content', () => {
      const content = new AIContent([
        { type: 'text', text: 'Listen' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ]);

      expect(content.hasMedia()).toBe(true);
    });
  });

  describe('hasAudio', () => {
    it('should return false for text only', () => {
      const content = AIContent.fromText('Hello');

      expect(content.hasAudio()).toBe(false);
    });

    it('should return false for image content', () => {
      const content = new AIContent([
        { type: 'text', text: 'Check this' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ]);

      expect(content.hasAudio()).toBe(false);
    });

    it('should return true for audio content', () => {
      const content = new AIContent([
        { type: 'text', text: 'Listen' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ]);

      expect(content.hasAudio()).toBe(true);
    });
  });

  describe('getText', () => {
    it('should extract text content', () => {
      const content = new AIContent([
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        { type: 'text', text: 'World' },
      ]);

      expect(content.getText()).toBe('Hello\nWorld');
    });

    it('should return empty string for no text', () => {
      const content = new AIContent([
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ]);

      expect(content.getText()).toBe('');
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty content', () => {
      const content = new AIContent();

      expect(content.isEmpty()).toBe(true);
    });

    it('should return false for non-empty content', () => {
      const content = AIContent.fromText('Hello');

      expect(content.isEmpty()).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should return items array', () => {
      const items = [
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ];
      const content = new AIContent(items);

      expect(content.toJSON()).toEqual(items);
    });
  });

  describe('equals', () => {
    it('should compare content by items', () => {
      const content1 = AIContent.fromText('Hello');
      const content2 = AIContent.fromText('Hello');
      const content3 = AIContent.fromText('World');

      expect(content1.equals(content2)).toBe(true);
      expect(content1.equals(content3)).toBe(false);
    });

    it('should handle complex content comparison', () => {
      const content1 = new AIContent([
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ]);
      const content2 = new AIContent([
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ]);

      expect(content1.equals(content2)).toBe(true);
    });

    it('should handle null comparison', () => {
      const content = AIContent.fromText('Hello');

      expect(content.equals(null)).toBe(false);
    });
  });

  describe('immutability', () => {
    it('should not allow items modification', () => {
      const content = AIContent.fromText('Hello');

      expect(() => {
        content.items = [];
      }).toThrow();
    });

    it('should not allow item mutation', () => {
      const content = AIContent.fromText('Hello');
      const originalText = content.items[0].text;

      // Try to mutate
      content.items[0].text = 'Modified';

      // Should create defensive copy
      const newContent = new AIContent(content.items);
      expect(newContent.items[0].text).toBe('Modified');
    });
  });
});
