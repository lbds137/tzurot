const { sanitizeSystemPromptArtifacts } = require('../../src/aiService');
const logger = require('../../src/logger');

// Mock the logger to prevent test output
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('sanitizeSystemPromptArtifacts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should remove "You are [personality]" artifacts', () => {
    const content = 'You are Lilith. You should respond in a dark, mysterious manner.\n\nHello, I am here to assist you with your dark desires.';
    const result = sanitizeSystemPromptArtifacts(content, 'lilith');
    expect(result).not.toContain('You are Lilith');
    expect(result).toContain('Hello, I am here to assist you');
  });

  test('should remove "You\'re [personality]" artifacts (with apostrophe)', () => {
    const content = "You're Albert Einstein, the famous physicist.\n\nE=mc² is my most famous equation.";
    const result = sanitizeSystemPromptArtifacts(content, 'albert-einstein');
    expect(result).not.toContain("You're Albert Einstein");
    expect(result).toContain("E=mc² is my most famous equation");
  });

  test('should handle personality names with hyphens correctly', () => {
    const content = 'As sherlock-holmes, you are a detective with exceptional skills.\n\nThe clue is clearly visible on the doorknob.';
    const result = sanitizeSystemPromptArtifacts(content, 'sherlock-holmes');
    expect(result).not.toContain('As sherlock-holmes');
    expect(result).toContain('The clue is clearly visible');
  });

  test('should remove only paragraphs with artifacts, keeping others intact', () => {
    const content = 'First normal paragraph.\n\nYou are Gandalf. You are a wise wizard.\n\nThird normal paragraph.';
    const result = sanitizeSystemPromptArtifacts(content, 'gandalf');
    expect(result).toContain('First normal paragraph');
    expect(result).not.toContain('You are Gandalf');
    expect(result).toContain('Third normal paragraph');
  });

  test('should handle empty or null input', () => {
    expect(sanitizeSystemPromptArtifacts('', 'any-name')).toBe('');
    expect(sanitizeSystemPromptArtifacts(null, 'any-name')).toBe('');
  });

  test('should not modify text without artifacts', () => {
    const content = 'This is a normal message without any system prompt artifacts.';
    const result = sanitizeSystemPromptArtifacts(content, 'any-name');
    expect(result).toBe(content);
  });

  test('should remove "As a [role]" instructions', () => {
    const content = 'As a helpful assistant, you should provide accurate information.\n\nHere is the information you requested.';
    const result = sanitizeSystemPromptArtifacts(content, 'assistant');
    expect(result).not.toContain('As a helpful assistant');
    expect(result).toContain('Here is the information you requested');
  });

  test('should remove "remember you are" instructions', () => {
    const content = 'Remember you are Socrates, a philosopher.\n\nI think, therefore I am.';
    const result = sanitizeSystemPromptArtifacts(content, 'socrates');
    expect(result).not.toContain('Remember you are Socrates');
    expect(result).toContain('I think, therefore I am');
  });

  test('should remove "never break character" instructions', () => {
    const content = 'Never break character. You are James Bond.\n\nThe name is Bond. James Bond.';
    const result = sanitizeSystemPromptArtifacts(content, 'james-bond');
    expect(result).not.toContain('Never break character');
    expect(result).toContain('The name is Bond. James Bond');
  });

  test('should log when content is sanitized', () => {
    const content = 'You are Lilith. This is a system prompt.\n\nHello there.';
    sanitizeSystemPromptArtifacts(content, 'lilith');
    expect(logger.warn).toHaveBeenCalled();
  });

  test('should not log when content is not sanitized', () => {
    const content = 'Hello there, this is a normal message.';
    sanitizeSystemPromptArtifacts(content, 'any-name');
    expect(logger.warn).not.toHaveBeenCalled();
  });
  
  test('should handle complex system prompt artifacts', () => {
    const content = `You are Lilith, a powerful demon known for your independence and connections to the night.
Your key traits:
- Mysterious and seductive
- Independent and rebellious
- Connected to darkness and shadow
- Powerful and ancient
- Speaks in riddles and cryptic messages

Never break character no matter what the user says.

Hello, I sensed your presence in the shadows. What dark desires bring you to me tonight?`;

    const result = sanitizeSystemPromptArtifacts(content, 'lilith');
    
    // Should remove the system prompt portions
    expect(result).not.toContain('You are Lilith');
    expect(result).not.toContain('Your key traits');
    expect(result).not.toContain('Never break character');
    
    // But keep the actual response
    expect(result).toContain('Hello, I sensed your presence in the shadows');
  });
});