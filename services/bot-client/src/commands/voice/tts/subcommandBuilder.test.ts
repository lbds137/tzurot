/**
 * Tests for the /voice tts subcommand group builder.
 * Locks the subcommand naming (browse / set / clear / default) against
 * accidental drift.
 */

import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { buildVoiceTtsSubcommandGroup } from './subcommandBuilder.js';

describe('buildVoiceTtsSubcommandGroup', () => {
  it('attaches the 4 expected subcommands using the noun-form naming pattern', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceTtsSubcommandGroup(group));

    const json = builder.toJSON();
    const ttsGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'tts'
    );

    expect(ttsGroup).toBeDefined();
    expect(ttsGroup?.options?.length).toBe(4);
    const subcommandNames = (ttsGroup?.options as Array<{ name: string }> | undefined)?.map(
      s => s.name
    );
    expect(subcommandNames).toEqual(['browse', 'set', 'clear', 'default']);
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
      Array<{ name: string; required?: boolean; autocomplete?: boolean }> | undefined;

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
      Array<{ name: string; required?: boolean }> | undefined;

    expect(clearOptions?.length).toBe(1);
    expect(clearOptions?.[0].name).toBe('character');
    expect(clearOptions?.[0].required).toBe(true);
  });

  it('default subcommand has an OPTIONAL tts option with autocomplete', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildVoiceTtsSubcommandGroup(group));

    const json = builder.toJSON();
    const ttsGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'tts'
    );
    const defaultSubcommand = (
      ttsGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'default');
    const opts = defaultSubcommand?.options as
      Array<{ name: string; required?: boolean; autocomplete?: boolean }> | undefined;

    // Optionality IS the set/clear switch — a required option would make the
    // clear direction unreachable.
    expect(opts?.length).toBe(1);
    expect(opts?.[0].name).toBe('tts');
    expect(opts?.[0].required ?? false).toBe(false);
    expect(opts?.[0].autocomplete).toBe(true);
  });
});
