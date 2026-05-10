/**
 * Tests for the /voice stt subcommand group builder.
 * Locks the symmetric subcommand naming and the static-choice provider option.
 */

import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { buildVoiceSttSubcommandGroup } from './subcommandBuilder.js';

function buildJson() {
  const builder = new SlashCommandBuilder().setName('test').setDescription('test');
  builder.addSubcommandGroup(group => buildVoiceSttSubcommandGroup(group));
  return builder.toJSON();
}

describe('buildVoiceSttSubcommandGroup', () => {
  it('attaches the 5 expected subcommands with symmetric naming', () => {
    const json = buildJson();
    const sttGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'stt'
    );

    expect(sttGroup).toBeDefined();
    expect(sttGroup?.options?.length).toBe(5);
    const names = (sttGroup?.options as Array<{ name: string }> | undefined)?.map(s => s.name);
    expect(names).toEqual(['browse', 'set', 'clear', 'set-default', 'clear-default']);
  });

  it('set requires personality (autocomplete) + provider (static choices)', () => {
    const json = buildJson();
    const sttGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'stt'
    );
    const setSub = (
      sttGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'set');
    const opts = setSub?.options as
      | Array<{
          name: string;
          required?: boolean;
          autocomplete?: boolean;
          choices?: Array<{ name: string; value: string }>;
        }>
      | undefined;

    expect(opts?.length).toBe(2);
    const personality = opts?.find(o => o.name === 'personality');
    expect(personality?.required).toBe(true);
    expect(personality?.autocomplete).toBe(true);

    const provider = opts?.find(o => o.name === 'provider');
    expect(provider?.required).toBe(true);
    expect(provider?.choices?.map(c => c.value).sort()).toEqual(
      ['elevenlabs', 'mistral', 'voice-engine'].sort()
    );
  });

  it('clear requires only personality', () => {
    const json = buildJson();
    const sttGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'stt'
    );
    const clearSub = (
      sttGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'clear');
    const opts = clearSub?.options as Array<{ name: string }> | undefined;
    expect(opts?.length).toBe(1);
    expect(opts?.[0].name).toBe('personality');
  });

  it('set-default requires only provider (no personality)', () => {
    const json = buildJson();
    const sttGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'stt'
    );
    const setDefault = (
      sttGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'set-default');
    const opts = setDefault?.options as Array<{ name: string }> | undefined;
    expect(opts?.length).toBe(1);
    expect(opts?.[0].name).toBe('provider');
  });

  it('clear-default has no options', () => {
    const json = buildJson();
    const sttGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'stt'
    );
    const clearDefault = (
      sttGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'clear-default');
    expect(clearDefault?.options ?? []).toEqual([]);
  });
});
