import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TextChannel } from 'discord.js';
import { bootParity, type ParityContext } from './instance.js';

describe('Machloket transport contract: configured message character limit', () => {
  let ctx: ParityContext;
  let channel: TextChannel;

  beforeAll(async () => {
    ctx = await bootParity({ limits: { message: { maxCharacters: 2000 } } });
    channel = (await ctx.client.channels.fetch(ctx.text.id)) as TextChannel;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('resolves channel.send with 2000 characters', async () => {
    const m = await channel.send('x'.repeat(2000));
    expect(m.content.length).toBe(2000);
  });

  // Machloket's field and message match a real Discord report per its server session; the code name was not probed against Discord.
  it('refuses channel.send with 2001 characters at a configured limit of 2000 with 50035 on content', async () => {
    await expect(channel.send('x'.repeat(2001))).rejects.toMatchObject({
      status: 400,
      code: 50035,
      message: 'Invalid Form Body\ncontent[BASE_TYPE_MAX_LENGTH]: Must be 2000 or fewer in length.',
    });
  });
});
