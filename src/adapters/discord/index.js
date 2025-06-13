/**
 * Discord Adapter exports
 * @module adapters/discord
 */

const { DiscordMessageAdapter } = require('./DiscordMessageAdapter');
const { DiscordWebhookAdapter } = require('./DiscordWebhookAdapter');

module.exports = {
  DiscordMessageAdapter,
  DiscordWebhookAdapter,
};
