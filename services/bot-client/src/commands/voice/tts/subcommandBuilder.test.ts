/**
 * Tests for the /voice tts subcommand group builder.
 * Locks the symmetric subcommand naming (set / clear / set-default /
 * clear-default / browse) against accidental drift.
 */

import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { buildVoiceTtsSubcommandGroup } from './subcommandBuilder.js';

describe('buildVoiceTtsSubcommandGroup', () => {
  it('attaches the 5 expected subcommands using the symmetric naming pattern', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceTtsSubcommandGroup(group));

    const json = builder.toJSON();
    const ttsGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'tts'
    );

    expect(ttsGroup).toBeDefined();
    expect(ttsGroup?.options?.length).toBe(5);
    const subcommandNames = (ttsGroup?.options as Array<{ name: string }> | undefined)?.map(
      s => s.name
    );
    expect(subcommandNames).toEqual(['browse', 'set', 'clear', 'set-default', 'clear-default']);
  });

  it('set subcommand requires personality + tts options with autocomplete', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceTtsSubcommandGroup(group));

    const json = builder.toJSON();
    const ttsGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'tts'
    );
    const setSubcommand = (
      ttsGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'set');
    const setOptions = setSubcommand?.options as
      | Array<{ name: string; required?: boolean; autocomplete?: boolean }>
      | undefined;

    expect(setOptions?.length).toBe(2);
    const personalityOpt = setOptions?.find(o => o.name === 'character');
    expect(personalityOpt?.required).toBe(true);
    expect(personalityOpt?.autocomplete).toBe(true);
    const ttsOpt = setOptions?.find(o => o.name === 'tts');
    expect(ttsOpt?.required).toBe(true);
    expect(ttsOpt?.autocomplete).toBe(true);
  });

  it('clear subcommand requires personality option (per-character clear)', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceTtsSubcommandGroup(group));

    const json = builder.toJSON();
    const ttsGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'tts'
    );
    const clearSubcommand = (
      ttsGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'clear');
    const clearOptions = clearSubcommand?.options as
      | Array<{ name: string; required?: boolean }>
      | undefined;

    expect(clearOptions?.length).toBe(1);
    expect(clearOptions?.[0].name).toBe('character');
    expect(clearOptions?.[0].required).toBe(true);
  });

  it('set-default subcommand requires the tts option (no personality scope)', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceTtsSubcommandGroup(group));

    const json = builder.toJSON();
    const ttsGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'tts'
    );
    const setDefault = (
      ttsGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'set-default');
    const opts = setDefault?.options as Array<{ name: string }> | undefined;

    expect(opts?.length).toBe(1);
    expect(opts?.[0].name).toBe('tts');
  });

  it('clear-default subcommand has no options (operates on the implicit global default)', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceTtsSubcommandGroup(group));

    const json = builder.toJSON();
    const ttsGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'tts'
    );
    const clearDefault = (
      ttsGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'clear-default');

    expect(clearDefault?.options ?? []).toEqual([]);
  });
});
