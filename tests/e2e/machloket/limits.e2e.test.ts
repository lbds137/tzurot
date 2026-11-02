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

  // doc-114: Discord answers 50035 here; the server's generic error is a known difference, and this message pins that the limit is what refused it.
  it('rejects channel.send with 2001 characters', async () => {
    await expect(channel.send('x'.repeat(2001))).rejects.toThrow(
      'Content length over max character limit'
    );
  });
});
