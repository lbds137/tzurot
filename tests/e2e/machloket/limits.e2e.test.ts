import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TextChannel } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { bootParity, type ParityContext } from './instance.js';

describe('Machloket transport contract: configured message character limit', () => {
  const limit = DISCORD_LIMITS.MESSAGE_LENGTH;
  let ctx: ParityContext;
  let channel: TextChannel;

  beforeAll(async () => {
    ctx = await bootParity({ limits: { message: { maxCharacters: limit } } });
    channel = (await ctx.client.channels.fetch(ctx.text.id)) as TextChannel;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('resolves channel.send at the configured limit', async () => {
    const m = await channel.send('x'.repeat(limit));
    expect(m.content.length).toBe(limit);
  });

  // The code and message are the server's and were not probed against Discord.
  it('refuses channel.send one character over the configured limit with 50035 on content', async () => {
    await expect(channel.send('x'.repeat(limit + 1))).rejects.toMatchObject({
      status: 400,
      code: 50035,
      message: `Invalid Form Body\ncontent[BASE_TYPE_MAX_LENGTH]: Must be ${limit} or fewer in length.`,
    });
  });
});
