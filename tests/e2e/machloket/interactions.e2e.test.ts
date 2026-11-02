import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Message, Routes, type TextChannel } from 'discord.js';
import { bootParity, type Frame, nextInteraction, type ParityContext } from './instance.js';

interface CommandRecord {
  id: string;
  version: string;
  application_id: string;
  name: string;
  type: number;
}

describe('Machloket transport contract: slash, component, modal, context-menu, and DM interactions', () => {
  let ctx: ParityContext;
  let channel: TextChannel;
  let putCommands: Partial<CommandRecord>[];
  let cmd: CommandRecord;
  let withButton: Message;

  const invoke = (data: unknown, extra: Record<string, unknown> = {}, type = 2): Promise<unknown> =>
    ctx.http('/v10/interactions', ctx.person.token, 'POST', {
      type,
      application_id: ctx.app.id,
      guild_id: ctx.guild.id,
      channel_id: ctx.text.id,
      session_id: ctx.session,
      nonce: String(Date.now()),
      data,
      ...extra,
    });

  const contentFrame = (want: string): Promise<Frame> =>
    ctx.waitFrame(
      f => (f.t === 'MESSAGE_CREATE' || f.t === 'MESSAGE_UPDATE') && f.d.content === want
    );

  const openModal = async (): Promise<Frame> => {
    const got = nextInteraction(ctx.client, i => i.customId === 'parity::go::1');
    await invoke(
      { component_type: 2, custom_id: 'parity::go::1' },
      { message_id: withButton.id, message_flags: 0 },
      3
    );
    const i = await got;
    await i.showModal({
      title: 'Parity',
      custom_id: 'parity::modal::1',
      components: [{ type: 1, components: [{ type: 4, custom_id: 'f', label: 'F', style: 1 }] }],
    });
    return ctx.waitFrame(
      f => f.t === 'INTERACTION_MODAL_CREATE' && f.d.custom_id === 'parity::modal::1',
      10_000
    );
  };

  beforeAll(async () => {
    ctx = await bootParity();
    channel = (await ctx.client.channels.fetch(ctx.text.id)) as TextChannel;
    putCommands = (await ctx.rest.put(Routes.applicationGuildCommands(ctx.app.id, ctx.guild.id), {
      body: [{ name: 'parity', description: 'parity probe', type: 1 }],
    })) as Partial<CommandRecord>[];
    const listed = (await ctx.rest.get(
      Routes.applicationGuildCommands(ctx.app.id, ctx.guild.id)
    )) as CommandRecord[];
    cmd = listed[0];
    withButton = await channel.send({
      content: 'pick',
      components: [
        { type: 1, components: [{ type: 2, style: 1, label: 'Go', custom_id: 'parity::go::1' }] },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: 'parity::sel::1',
              options: [{ label: 'A', value: 'a' }],
            },
          ],
        },
      ],
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('registers guild commands via PUT and reads back their ids via GET', () => {
    expect(Array.isArray(putCommands)).toBe(true);
    expect(putCommands.length).toBe(1);
    expect(typeof cmd.id).toBe('string');
    expect(typeof cmd.version).toBe('string');
  });

  it('returns id, version, application_id, and name on the first entry of the PUT guild commands response', () => {
    expect(typeof putCommands[0]?.id).toBe('string');
    expect(typeof putCommands[0]?.version).toBe('string');
    expect(putCommands[0]?.application_id).toBe(ctx.app.id);
    expect(putCommands[0]?.name).toBe('parity');
  });

  it('handles slash command deferReply and editReply reaching person gateway with commandName, user.username, and non-null member', async () => {
    const got = nextInteraction(ctx.client, i => i.commandName === 'parity');
    await invoke({ version: cmd.version, id: cmd.id, name: 'parity', type: 1, options: [] });
    const i = await got;
    await i.deferReply();
    expect(i.deferred).toBe(true);
    await i.editReply('deferred then edited');
    const frame = await contentFrame('deferred then edited');
    expect(frame.d.content).toBe('deferred then edited');
    expect(i.commandName).toBe('parity');
    expect(i.user.username).toContain('person');
    expect(i.member).not.toBeNull();
  });

  it('handles ephemeral reply (flags 64) and followUp (flags 64) with flag 64 preserved', async () => {
    const got = nextInteraction(ctx.client, i => i.commandName === 'parity');
    await invoke({ version: cmd.version, id: cmd.id, name: 'parity', type: 1, options: [] });
    const i = await got;
    await i.reply({ content: 'only you', flags: 64 });
    const follow = await i.followUp({ content: 'follow up', flags: 64 });
    expect((follow.flags?.bitfield ?? 0) & 64).toBe(64);
  });

  it('sends a message with button and string-select component rows', () => {
    expect(withButton.components.length).toBe(2);
  });

  it('handles button deferUpdate and followUp', async () => {
    const gotButton = nextInteraction(ctx.client, i => i.customId === 'parity::go::1');
    await invoke(
      { component_type: 2, custom_id: 'parity::go::1' },
      { message_id: withButton.id, message_flags: 0 },
      3
    );
    const btnInteraction = await gotButton;
    await btnInteraction.deferUpdate();
    await btnInteraction.followUp({ content: 'button followed', flags: 64 });
    expect(btnInteraction.customId).toBe('parity::go::1');
  });

  it('handles string-select update with selected values', async () => {
    const gotSelect = nextInteraction(ctx.client, i => i.customId === 'parity::sel::1');
    await invoke(
      { component_type: 3, custom_id: 'parity::sel::1', values: ['a'] },
      { message_id: withButton.id, message_flags: 0 },
      3
    );
    const selectInteraction = await gotSelect;
    await selectInteraction.update({ content: 'updated' });
    expect(selectInteraction.values).toEqual(['a']);
  });

  it('emits INTERACTION_MODAL_CREATE on person gateway when showModal is called', async () => {
    const modalFrame = await openModal();
    expect(modalFrame.t).toBe('INTERACTION_MODAL_CREATE');
  });

  it('delivers modal submission with text input value and replies ephemerally', async () => {
    const modalFrame = await openModal();
    const got = nextInteraction(ctx.client, i => i.customId === 'parity::modal::1');
    await invoke(
      {
        id: modalFrame.d.id,
        custom_id: 'parity::modal::1',
        components: [{ type: 1, components: [{ type: 4, custom_id: 'f', value: 'typed' }] }],
      },
      { message_id: withButton.id },
      5
    );
    const submitted = await got;
    await submitted.reply({ content: 'modal ok', flags: 64 });
    expect(submitted.fields.getTextInputValue('f')).toBe('typed');
  });

  it('registers and invokes a message context-menu command with targetId and isMessageContextMenuCommand()', async () => {
    const created = (await ctx.rest.post(
      Routes.applicationGuildCommands(ctx.app.id, ctx.guild.id),
      {
        body: { name: 'Parity Msg', type: 3 },
      }
    )) as CommandRecord;
    expect(typeof created.id).toBe('string');
    const all = (await ctx.rest.get(
      Routes.applicationGuildCommands(ctx.app.id, ctx.guild.id)
    )) as CommandRecord[];
    const mc = all.find(x => x.type === 3)!;

    const got = nextInteraction(ctx.client, i => i.commandName === 'Parity Msg');
    await invoke({
      version: mc.version,
      id: mc.id,
      name: 'Parity Msg',
      type: 3,
      target_id: withButton.id,
    });
    const i = await got;
    await i.reply({ content: 'ctx', flags: 64 });
    expect(i.targetId).toBe(withButton.id);
    expect(i.isMessageContextMenuCommand()).toBe(true);
  });

  it('invokes a global command from a DM channel with no guild_id, deferring with flags 64 and editing', async () => {
    const dm = await ctx.http<{ id: string }>('/v10/users/@me/channels', ctx.person.token, 'POST', {
      recipients: [ctx.client.user.id],
    });
    await ctx.rest.put(Routes.applicationCommands(ctx.app.id), {
      body: [
        {
          name: 'parityglobal',
          description: 'global',
          type: 1,
          contexts: [0, 1, 2],
          integration_types: [0, 1],
        },
      ],
    });
    const gl = (await ctx.rest.get(Routes.applicationCommands(ctx.app.id))) as CommandRecord[];

    const got = nextInteraction(ctx.client, i => i.commandName === 'parityglobal');
    await ctx.http('/v10/interactions', ctx.person.token, 'POST', {
      type: 2,
      application_id: ctx.app.id,
      channel_id: dm.id,
      session_id: ctx.session,
      nonce: 'dm',
      data: {
        version: gl[0].version,
        id: gl[0].id,
        name: 'parityglobal',
        type: 1,
        options: [],
      },
    });
    const i = await got;
    await i.deferReply({ flags: 64 });
    await i.editReply('dm deferred');
    expect(i.commandName).toBe('parityglobal');
    expect(i.guildId).toBeNull();
    expect(i.channel?.type).toBe(1);
  });
});
