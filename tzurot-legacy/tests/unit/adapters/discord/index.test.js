/**
 * @jest-environment node
 *
 * Discord Adapters Index Test
 * - Tests the exports from adapters/discord/index.js
 */

const discordAdapters = require('../../../../src/adapters/discord');
const { DiscordMessageAdapter } = require('../../../../src/adapters/discord/DiscordMessageAdapter');
const { DiscordWebhookAdapter } = require('../../../../src/adapters/discord/DiscordWebhookAdapter');

describe('Discord Adapters Index', () => {
  it('should export DiscordMessageAdapter', () => {
    expect(discordAdapters.DiscordMessageAdapter).toBeDefined();
    expect(discordAdapters.DiscordMessageAdapter).toBe(DiscordMessageAdapter);
  });

  it('should export DiscordWebhookAdapter', () => {
    expect(discordAdapters.DiscordWebhookAdapter).toBeDefined();
    expect(discordAdapters.DiscordWebhookAdapter).toBe(DiscordWebhookAdapter);
  });

  it('should export exactly the expected modules', () => {
    const exportedKeys = Object.keys(discordAdapters).sort();
    expect(exportedKeys).toEqual(['DiscordMessageAdapter', 'DiscordWebhookAdapter']);
  });
});
