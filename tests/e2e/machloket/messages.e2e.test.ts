import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TextChannel, type Webhook } from 'discord.js';
import { bootParity, nextMessage, type ParityContext } from './instance.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return (e as { code?: unknown }).code;
  }
}

describe('Machloket transport contract: messages, webhooks, DMs, guild state, and REST errors', () => {
  let ctx: ParityContext;
  let channel: TextChannel;
  let webhook: Webhook;

  beforeAll(async () => {
    ctx = await bootParity();
    channel = (await ctx.client.channels.fetch(ctx.text.id)) as TextChannel;
    webhook = await channel.createWebhook({ name: 'parity-hook' });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('delivers person message to the bot with content, inGuild(), and non-null member', async () => {
    const got = nextMessage(ctx.client, m => m.content === 'hello from person');
    await ctx.http(`/v10/channels/${ctx.text.id}/messages`, ctx.person.token, 'POST', {
      content: 'hello from person',
    });
    const m = await got;
    expect(m.content).toBe('hello from person');
    expect(m.inGuild()).toBe(true);
    expect(m.member).not.toBeNull();
  });

  it('delivers bot send to person gateway by id with createdTimestamp within 60 s of now', async () => {
    const sent = await channel.send('hello from bot');
    const frame = await ctx.waitFrame(f => f.t === 'MESSAGE_CREATE' && f.d.id === sent.id);
    expect(typeof sent.id).toBe('string');
    expect(sent.tts).toBe(false);
    expect(frame.d.id).toBe(sent.id);
    expect(Math.abs(Date.now() - sent.createdTimestamp)).toBeLessThan(60_000);
  });

  it('sends typing indicator without error', async () => {
    await expect(channel.sendTyping()).resolves.toBeUndefined();
  });

  it('delivers bot message edit as MESSAGE_UPDATE by id to person gateway', async () => {
    const sent = await channel.send('to edit');
    const edited = await sent.edit('edited');
    const frame = await ctx.waitFrame(f => f.t === 'MESSAGE_UPDATE' && f.d.id === sent.id);
    expect(edited.content).toBe('edited');
    expect(frame.d.id).toBe(sent.id);
  });

  it('populates reference.messageId on bot reply', async () => {
    const sent = await channel.send('to reply');
    const reply = await sent.reply('a reply');
    expect(reply.reference?.messageId).toBe(sent.id);
  });

  it('delivers bot message delete as MESSAGE_DELETE by id to person gateway', async () => {
    const sent = await channel.send('to delete');
    await sent.delete();
    const frame = await ctx.waitFrame(f => f.t === 'MESSAGE_DELETE' && f.d.id === sent.id);
    expect(frame.d.id).toBe(sent.id);
  });

  it('creates a webhook, sends with username and avatarURL, sends a file, and lists 1 webhook', async () => {
    expect(typeof webhook.token).toBe('string');

    const got = nextMessage(ctx.client, m => m.content === 'as a persona');
    await webhook.send({
      content: 'as a persona',
      username: 'Persona Name',
      avatarURL: `${ctx.origin}/nope.png`,
    });
    const m = await got;
    expect(m.webhookId).toBe(webhook.id);
    expect(m.author.username).toBe('Persona Name');
    expect(m.author.bot).toBe(true);

    const fileMsg = await webhook.send({
      content: 'file',
      username: 'Persona',
      files: [{ attachment: Buffer.from('hi'), name: 'a.txt' }],
      allowedMentions: { parse: [] },
    });
    expect(fileMsg.attachments.size).toBe(1);

    const webhooks = await channel.fetchWebhooks();
    expect(webhooks.size).toBe(1);
  });

  it('fetches an uploaded attachment via attachment.proxyURL with redirect: error as status 200', async () => {
    const m = await channel.send({ files: [{ attachment: ONE_PIXEL_PNG, name: 'p.png' }] });
    const attachment = m.attachments.first()!;
    expect(attachment.proxyURL).not.toContain('//attachments');
    const res = await fetch(attachment.proxyURL, { redirect: 'error' });
    expect(res.status).toBe(200);
  });

  it('resolves webhook.send with 1- and 80-character usernames and rejects 81 characters with code 50035', async () => {
    const shortMsg = await webhook.send({ content: 'n', username: 'x' });
    expect(shortMsg.author.username).toBe('x');

    const maxMsg = await webhook.send({ content: 'n', username: 'x'.repeat(80) });
    expect(maxMsg.author.username).toBe('x'.repeat(80));

    await expect(webhook.send({ content: 'n', username: 'x'.repeat(81) })).rejects.toMatchObject({
      code: 50035,
    });
  });

  it.each(['Support Persona', 'Spacebar Steam Community Ticket', 'everyone', 'here'])(
    'resolves webhook.send with username %s',
    async username => {
      const m = await webhook.send({ content: 'n', username });
      expect(m.author.username).toBe(username);
    }
  );

  it.each([
    ['My Clyde Hook', 'clyde'],
    ['my discord hook', 'discord'],
  ])('refuses webhook.send with username %s with 50035 on username', async (username, word) => {
    await expect(webhook.send({ content: 'n', username })).rejects.toMatchObject({
      status: 400,
      code: 50035,
      message: `Invalid Form Body\nusername[USERNAME_INVALID_CONTAINS]: Username cannot contain "${word}"`,
    });
  });

  it('refuses createWebhook named My Clyde Hook with 50035 on name', async () => {
    await expect(channel.createWebhook({ name: 'My Clyde Hook' })).rejects.toMatchObject({
      status: 400,
      code: 50035,
      message:
        'Invalid Form Body\nname[USERNAME_INVALID_CONTAINS]: Username cannot contain "clyde"',
    });
  });

  it('suppresses @everyone and user mentions under default allowedMentions: { parse: [] }', async () => {
    const m = await channel.send(`@everyone <@${ctx.person.id}>`);
    expect(m.mentions.everyone).toBe(false);
    expect(m.mentions.users.size).toBe(0);
  });

  it('reacts with 🔧 and reads the reaction back from a fresh message fetch', async () => {
    const m = await channel.send('react me');
    await m.react('🔧');
    const back = await channel.messages.fetch(m.id);
    expect(back.reactions.cache.map(r => r.emoji.name)).toEqual(['🔧']);
  });

  it('delivers DM from person to bot with null guildId, channel type 1, and partial false', async () => {
    const dm = await ctx.http<{ id: string }>('/v10/users/@me/channels', ctx.person.token, 'POST', {
      recipients: [ctx.client.user.id],
    });
    const got = nextMessage(ctx.client, m => m.content === 'dm to bot');
    await ctx.http(`/v10/channels/${dm.id}/messages`, ctx.person.token, 'POST', {
      content: 'dm to bot',
    });
    const m = await got;
    expect(m.content).toBe('dm to bot');
    expect(m.guildId).toBeNull();
    expect(m.channel.type).toBe(1);
    expect(m.partial).toBe(false);
  });

  it('delivers DM from bot to person gateway', async () => {
    const user = await ctx.client.users.fetch(ctx.person.id);
    const m = await user.send('dm to person');
    const frame = await ctx.waitFrame(f => f.t === 'MESSAGE_CREATE' && f.d.id === m.id);
    expect(frame.d.id).toBe(m.id);
  });

  it('fetches 1 guild member with an empty query and limit 1', async () => {
    const guild = ctx.client.guilds.cache.get(ctx.guild.id)!;
    const members = await guild.members.fetch({ query: '', limit: 1 });
    expect(members.size).toBe(1);
  });

  it('resolves ViewChannel, ReadMessageHistory, and ManageMessages permissions for the bot member', async () => {
    const guild = ctx.client.guilds.cache.get(ctx.guild.id)!;
    const me = await guild.members.fetchMe();
    const perms = channel.permissionsFor(me)!;
    expect(perms.has('ViewChannel')).toBe(true);
    expect(perms.has('ReadMessageHistory')).toBe(true);
    expect(perms.has('ManageMessages')).toBe(true);
  });

  it('matches client.application.id to the created application id', () => {
    expect(ctx.client.application.id).toBe(ctx.app.id);
  });

  it('surfaces Discord REST error codes 10003, 10008, 10013, and 10007 on unknown snowflakes', async () => {
    const unknownId = '100000000000000000';
    const guild = ctx.client.guilds.cache.get(ctx.guild.id)!;
    expect(await codeOf(ctx.client.channels.fetch(unknownId, { force: true }))).toBe(10003);
    expect(await codeOf(channel.messages.fetch(unknownId))).toBe(10008);
    expect(await codeOf(ctx.client.users.fetch(unknownId, { force: true }))).toBe(10013);
    expect(await codeOf(guild.members.fetch({ user: unknownId, force: true }))).toBe(10007);
  });

  it('resolves channel.send with 4000 characters and refuses 4001 at the default limit', async () => {
    const m = await channel.send('x'.repeat(4000));
    expect(m.content.length).toBe(4000);
    await expect(channel.send('x'.repeat(4001))).rejects.toMatchObject({
      status: 400,
      code: 50035,
      message: 'Invalid Form Body\ncontent[BASE_TYPE_MAX_LENGTH]: Must be 4000 or fewer in length.',
    });
  });
});
