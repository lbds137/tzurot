import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, GatewayIntentBits } from 'discord.js';
import { buildDiscordClientOptions } from '../../../services/bot-client/src/utils/discordClientOptions.js';
import { bootParity, loginAndReady, nextMessage, type ParityContext } from './instance.js';

describe('Machloket transport contract: gateway intents filtering', () => {
  let ctx: ParityContext;

  beforeAll(async () => {
    ctx = await bootParity();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  // doc-114 gap 7: goes red when the server is fixed; then assert Discord's behaviour instead.
  it('known gap 7: delivers full guild message content to a client without GatewayIntentBits.MessageContent', async () => {
    const baseOptions = buildDiscordClientOptions(ctx.origin);
    expect(Array.isArray(baseOptions.intents)).toBe(true);
    const originalIntents = baseOptions.intents as GatewayIntentBits[];
    const intents = originalIntents.filter(i => i !== GatewayIntentBits.MessageContent);
    expect(intents.length).toBe(originalIntents.length - 1);

    const secondClient = new Client({
      ...baseOptions,
      intents,
    });
    try {
      await loginAndReady(secondClient, ctx.bot.token);
      const got = nextMessage(
        secondClient,
        m => m.channelId === ctx.text.id && m.author.id === ctx.person.id
      );
      await ctx.http(`/v10/channels/${ctx.text.id}/messages`, ctx.person.token, 'POST', {
        content: 'guild message without MessageContent intent',
      });
      const m = await got;
      expect(m.content).toBe('guild message without MessageContent intent');
    } finally {
      await secondClient.destroy();
    }
  });

  // doc-114 gap 7: goes red when the server is fixed; then assert Discord's behaviour instead.
  it('known gap 7: delivers person DM to a client without GatewayIntentBits.DirectMessages', async () => {
    const baseOptions = buildDiscordClientOptions(ctx.origin);
    expect(Array.isArray(baseOptions.intents)).toBe(true);
    const originalIntents = baseOptions.intents as GatewayIntentBits[];
    const intents = originalIntents.filter(i => i !== GatewayIntentBits.DirectMessages);
    expect(intents.length).toBe(originalIntents.length - 1);

    const secondClient = new Client({
      ...baseOptions,
      intents,
    });
    try {
      await loginAndReady(secondClient, ctx.bot.token);
      const dm = await ctx.http<{ id: string }>(
        '/v10/users/@me/channels',
        ctx.person.token,
        'POST',
        {
          recipients: [ctx.client.user.id],
        }
      );
      const got = nextMessage(
        secondClient,
        m => m.channelId === dm.id && m.author.id === ctx.person.id
      );
      await ctx.http(`/v10/channels/${dm.id}/messages`, ctx.person.token, 'POST', {
        content: 'dm without DirectMessages intent',
      });
      const m = await got;
      expect(m.content).toBe('dm without DirectMessages intent');
      expect(m.guildId).toBeNull();
    } finally {
      await secondClient.destroy();
    }
  });
});
