/**
 * Tests for the /voice voices subcommand group builder.
 * Schema preserved verbatim from the legacy /settings voices group.
 */

import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { buildVoiceVoicesSubcommandGroup } from './subcommandBuilder.js';

describe('buildVoiceVoicesSubcommandGroup', () => {
  it('attaches the 3 expected subcommands (browse / delete / purge)', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceVoicesSubcommandGroup(group));

    const json = builder.toJSON();
    const voicesGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'voices'
    );

    expect(voicesGroup).toBeDefined();
    expect(voicesGroup?.options?.length).toBe(3);
    const subcommandNames = (voicesGroup?.options as Array<{ name: string }> | undefined)?.map(
      s => s.name
    );
    expect(subcommandNames).toEqual(['browse', 'delete', 'purge']);
  });

  it('delete subcommand requires the voice option with autocomplete', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceVoicesSubcommandGroup(group));

    const json = builder.toJSON();
    const voicesGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'voices'
    );
    const deleteSubcommand = (
      voicesGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'delete');
    const opts = deleteSubcommand?.options as
      Array<{ name: string; required?: boolean; autocomplete?: boolean }> | undefined;

    expect(opts?.length).toBe(1);
    expect(opts?.[0].name).toBe('voice');
    expect(opts?.[0].required).toBe(true);
    expect(opts?.[0].autocomplete).toBe(true);
  });

  it('browse and purge subcommands take no options', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceVoicesSubcommandGroup(group));

    const json = builder.toJSON();
    const voicesGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'voices'
    );
    const subcommands = voicesGroup?.options as
      Array<{ name: string; options?: unknown[] }> | undefined;

    expect(subcommands?.find(s => s.name === 'browse')?.options ?? []).toEqual([]);
    expect(subcommands?.find(s => s.name === 'purge')?.options ?? []).toEqual([]);
  });
});
