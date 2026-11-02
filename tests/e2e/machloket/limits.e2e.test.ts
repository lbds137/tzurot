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

  // doc-114 gap 5: goes red when the server changes its error. Discord's docs, from memory and not probed, give 50035 here; this message pins that the limit is what refused it.
  it('known gap 5: rejects channel.send with 2001 characters using a generic error', async () => {
    await expect(channel.send('x'.repeat(2001))).rejects.toThrow(
      'Content length over max character limit'
    );
  });
});
