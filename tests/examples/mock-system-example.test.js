/**
 * Example test demonstrating the new consolidated mock system
 * This file shows how to use the new mocks effectively
 */

// Mock the config module first
jest.mock('../../config', () => ({
  botPrefix: '!tz'
}));

const { presets, discord, api, modules } = require('../__mocks__');
const { botPrefix } = require('../../config');

describe('Consolidated Mock System Examples', () => {
  describe('Using Presets', () => {
    it('should work with command test preset', () => {
      const mockEnv = presets.commandTest({
        userPermissions: ['ADMINISTRATOR']
      });

      // Create a mock message
      const message = mockEnv.discord.createMessage({
        content: `${botPrefix} help`,
        author: { id: 'user-123', username: 'testuser' }
      });

      expect(message.content).toBe(`${botPrefix} help`);
      expect(message.author.id).toBe('user-123');
      expect(typeof message.reply).toBe('function');
    });

    it('should work with webhook test preset', () => {
      const mockEnv = presets.webhookTest({
        mockResponses: {
          'test-personality': 'Mock AI response from test personality'
        }
      });

      expect(mockEnv.api.ai).toBeDefined();
      expect(typeof mockEnv.discord.createWebhook).toBe('function');
    });
  });

  describe('Manual Mock Creation', () => {
    it('should create Discord mocks manually', () => {
      const discordEnv = discord.createDiscordEnvironment({
        setupDefaults: true
      });

      // Test client creation
      expect(discordEnv.client).toBeDefined();
      expect(typeof discordEnv.client.login).toBe('function');

      // Test message creation
      const message = discordEnv.createMessage({
        content: 'Test message',
        author: { username: 'testuser' }
      });
      
      expect(message.content).toBe('Test message');
      expect(message.author.username).toBe('testuser');
    });

    it('should create API mocks manually', () => {
      const apiEnv = api.createApiEnvironment({
        setupDefaults: true
      });

      // Test fetch mock
      expect(apiEnv.fetch).toBeDefined();
      expect(typeof apiEnv.fetch.setResponse).toBe('function');

      // Test AI service mock
      expect(apiEnv.ai).toBeDefined();
      expect(typeof apiEnv.ai.createChatCompletion).toBe('function');
    });

    it('should create module mocks manually', () => {
      const moduleEnv = modules.createModuleEnvironment({
        personalityManager: {
          defaultPersonality: {
            fullName: 'custom-test-personality',
            displayName: 'Custom Test Bot'
          }
        }
      });

      expect(moduleEnv.personalityManager).toBeDefined();
      expect(moduleEnv.personalityManager.getPersonality('custom-test-personality')).toBeTruthy();
    });
  });

  describe('Advanced Mock Usage', () => {
    it('should handle custom API responses', async () => {
      const apiEnv = api.createApiEnvironment();
      
      // Set up custom response
      apiEnv.fetch.setResponse('/test-endpoint', {
        ok: true,
        status: 200,
        data: { message: 'Custom response' }
      });

      // Test the mock - fetch is a MockFetch instance with a fetch method
      const response = await apiEnv.fetch.fetch('/test-endpoint');
      const data = await response.json();
      
      expect(data.message).toBe('Custom response');
      expect(response.ok).toBe(true);
    });

    it('should handle AI service responses', async () => {
      const apiEnv = api.createApiEnvironment();
      
      const response = await apiEnv.ai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are personality: test-bot' },
          { role: 'user', content: 'Hello world' }
        ]
      });

      expect(response.choices[0].message.content).toContain('[test-bot]');
      expect(response.choices[0].message.content).toContain('Hello world');
    });

    it('should integrate multiple mock systems', () => {
      // Create a complete test environment
      const mockEnv = presets.integrationTest();
      
      // Test Discord integration
      const message = mockEnv.discord.createMessage({
        content: 'Test integration',
        channel: { id: 'test-channel' }
      });
      
      // Test personality manager integration
      mockEnv.modules.personalityManager.activatePersonality('test-channel', 'test-personality');
      const activated = mockEnv.modules.personalityManager.getActivatedPersonality('test-channel');
      
      expect(activated).toBe('test-personality');
      expect(message.channel.id).toBe('test-channel');
    });
  });

  describe('Mock State Management', () => {
    it('should maintain state across mock interactions', () => {
      const moduleEnv = modules.createModuleEnvironment();
      
      // Add a personality
      moduleEnv.personalityManager._addTestPersonality({
        fullName: 'state-test-personality',
        displayName: 'State Test'
      });
      
      // Verify it exists
      const personality = moduleEnv.personalityManager.getPersonality('state-test-personality');
      expect(personality).toBeTruthy();
      expect(personality.displayName).toBe('State Test');
      
      // Clear state
      moduleEnv.personalityManager._clearAll();
      
      // Verify it's gone (except default)
      const clearedPersonality = moduleEnv.personalityManager.getPersonality('state-test-personality');
      expect(clearedPersonality).toBeNull();
    });
  });
});