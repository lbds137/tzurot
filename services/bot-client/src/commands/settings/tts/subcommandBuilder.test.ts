/**
 * Tests for the TTS subcommand group builder.
 * Locks the slash-command shape against accidental drift.
 */

import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { buildTtsSubcommandGroup } from './subcommandBuilder.js';

describe('buildTtsSubcommandGroup', () => {
  it('attaches the 5 expected subcommands to the group', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildTtsSubcommandGroup(group));

    const json = builder.toJSON();
    const ttsGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'tts'
    );

    expect(ttsGroup).toBeDefined();
    expect(ttsGroup?.options?.length).toBe(5);
    const subcommandNames = (ttsGroup?.options as Array<{ name: string }> | undefined)?.map(
      s => s.name
    );
    expect(subcommandNames).toEqual(['browse', 'set', 'reset', 'default', 'clear-default']);
  });

  it('set subcommand has both personality + tts options as required + autocomplete', () => {
    const builder = new SlashCommandBuilder().setName('test').setDescription('test');
    builder.addSubcommandGroup(group => buildTtsSubcommandGroup(group));

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
    expect(setOptions?.find(o => o.name === 'personality')?.required).toBe(true);
    expect(setOptions?.find(o => o.name === 'personality')?.autocomplete).toBe(true);
    expect(setOptions?.find(o => o.name === 'tts')?.required).toBe(true);
    expect(setOptions?.find(o => o.name === 'tts')?.autocomplete).toBe(true);
  });
});
