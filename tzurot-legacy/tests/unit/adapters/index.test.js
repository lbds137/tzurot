/**
 * @jest-environment node
 *
 * Main Adapters Index Test
 * - Tests the exports from adapters/index.js
 */

const adapters = require('../../../src/adapters');

describe('Main Adapters Index', () => {
  describe('namespace exports', () => {
    it('should export ai namespace', () => {
      expect(adapters.ai).toBeDefined();
      expect(adapters.ai.HttpAIServiceAdapter).toBeDefined();
      expect(adapters.ai.AIServiceAdapterFactory).toBeDefined();
    });

    it('should export discord namespace', () => {
      expect(adapters.discord).toBeDefined();
      expect(adapters.discord.DiscordMessageAdapter).toBeDefined();
      expect(adapters.discord.DiscordWebhookAdapter).toBeDefined();
    });

    it('should export persistence namespace', () => {
      expect(adapters.persistence).toBeDefined();
      expect(adapters.persistence.FilePersonalityRepository).toBeDefined();
      expect(adapters.persistence.FileConversationRepository).toBeDefined();
      expect(adapters.persistence.FileAuthenticationRepository).toBeDefined();
      expect(adapters.persistence.MemoryConversationRepository).toBeDefined();
    });
  });

  describe('convenience exports', () => {
    it('should export AI adapters directly', () => {
      expect(adapters.HttpAIServiceAdapter).toBeDefined();
      expect(adapters.AIServiceAdapterFactory).toBeDefined();
    });

    it('should export Discord adapters directly', () => {
      expect(adapters.DiscordMessageAdapter).toBeDefined();
      expect(adapters.DiscordWebhookAdapter).toBeDefined();
    });

    it('should export persistence adapters directly', () => {
      expect(adapters.FilePersonalityRepository).toBeDefined();
      expect(adapters.FileConversationRepository).toBeDefined();
      expect(adapters.FileAuthenticationRepository).toBeDefined();
      expect(adapters.MemoryConversationRepository).toBeDefined();
    });
  });

  it('should have all expected top-level exports', () => {
    const expectedExports = [
      'ai',
      'discord',
      'persistence',
      'HttpAIServiceAdapter',
      'AIServiceAdapterFactory',
      'DiscordMessageAdapter',
      'DiscordWebhookAdapter',
      'FilePersonalityRepository',
      'FileConversationRepository',
      'FileAuthenticationRepository',
      'MemoryConversationRepository',
    ].sort();

    const actualExports = Object.keys(adapters).sort();
    expect(actualExports).toEqual(expectedExports);
  });
});
