import { describe, it, expect } from 'vitest';
import { GatewayIntentBits, Partials } from 'discord.js';
import { buildDiscordClientOptions } from './discordClientOptions.js';

const ORIGIN = 'https://deck.tailnet.example:8443';

describe('buildDiscordClientOptions', () => {
  it('builds the exact base options with no rest key when origin is unset', () => {
    const options = buildDiscordClientOptions(undefined);

    expect('rest' in options).toBe(false);
    expect(options).toEqual({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.User],
      allowedMentions: { parse: [] },
    });
  });

  it('adds rest overrides for a configured origin, keeping intents/partials unchanged', () => {
    const options = buildDiscordClientOptions(ORIGIN);

    expect(options.rest).toEqual({
      api: `${ORIGIN}/api`,
      cdn: ORIGIN,
      mediaProxy: ORIGIN,
    });
    expect(options.intents).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
    ]);
    expect(options.partials).toEqual([Partials.Channel, Partials.Message, Partials.User]);
  });
});
