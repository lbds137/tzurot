import { describe, expect, it } from 'vitest';

import { classify, type ClassifiableHit } from './categories.js';
import type { SurfaceCategory } from './types.js';

function hit(overrides: Partial<ClassifiableHit>): ClassifiableHit {
  return {
    kind: 'call',
    symbolName: 'unknown',
    ...overrides,
  };
}

describe('classify', () => {
  it('routes Events enum members to gateway-events', () => {
    expect(
      classify(hit({ kind: 'enum-member', symbolName: 'MessageCreate', containerName: 'Events' }))
    ).toBe('gateway-events');
  });

  it('routes MessageFlags enum members to flags', () => {
    expect(
      classify(hit({ kind: 'enum-member', symbolName: 'Ephemeral', containerName: 'MessageFlags' }))
    ).toBe('flags');
  });

  it('routes component enum members to components', () => {
    expect(
      classify(hit({ kind: 'enum-member', symbolName: 'Short', containerName: 'TextInputStyle' }))
    ).toBe('components');
  });

  it('routes enum members of unmapped containers to discord-enums (the default route)', () => {
    expect(
      classify(hit({ kind: 'enum-member', symbolName: 'Primary', containerName: 'ButtonStyle' }))
    ).toBe('discord-enums');
    expect(
      classify(hit({ kind: 'enum-member', symbolName: 'Whatever', containerName: 'SomeOtherEnum' }))
    ).toBe('discord-enums');
  });

  it('routes enum members with no resolvable container to discord-enums', () => {
    expect(classify(hit({ kind: 'enum-member', symbolName: 'Whatever' }))).toBe('discord-enums');
  });

  it('routes message builder construction to message-builders', () => {
    expect(classify(hit({ kind: 'new', symbolName: 'EmbedBuilder' }))).toBe('message-builders');
    expect(classify(hit({ kind: 'new', symbolName: 'AttachmentBuilder' }))).toBe(
      'message-builders'
    );
  });

  it('routes select-menu option builder construction to components', () => {
    expect(classify(hit({ kind: 'new', symbolName: 'StringSelectMenuOptionBuilder' }))).toBe(
      'components'
    );
  });

  it('routes builder construction to components', () => {
    expect(classify(hit({ kind: 'new', symbolName: 'ButtonBuilder' }))).toBe('components');
  });

  it('routes command option builder construction to command-options', () => {
    expect(classify(hit({ kind: 'new', symbolName: 'SlashCommandStringOption' }))).toBe(
      'command-options'
    );
  });

  it('routes construction of unknown classes to unclassified', () => {
    expect(classify(hit({ kind: 'new', symbolName: 'UnmappedClass' }))).toBe('unclassified');
  });

  it('routes Webhook option keys to webhook-options', () => {
    expect(
      classify(hit({ kind: 'option-key', symbolName: 'content', receiverTypeName: 'Webhook' }))
    ).toBe('webhook-options');
  });

  it('routes Webhook receivers to webhook-options even for MESSAGE_OPTION_KEYS members (precedence (a) beats (c))', () => {
    for (const key of ['embeds', 'components', 'flags', 'allowedMentions']) {
      expect(
        classify(hit({ kind: 'option-key', symbolName: key, receiverTypeName: 'Webhook' }))
      ).toBe('webhook-options');
    }
  });

  it('routes builder-receiver option keys to their builder family', () => {
    expect(
      classify(hit({ kind: 'option-key', symbolName: 'name', receiverTypeName: 'EmbedBuilder' }))
    ).toBe('message-builders');
    expect(
      classify(
        hit({
          kind: 'option-key',
          symbolName: 'value',
          receiverTypeName: 'SlashCommandStringOption',
        })
      )
    ).toBe('command-options');
    expect(
      classify(hit({ kind: 'option-key', symbolName: 'label', receiverTypeName: 'ButtonBuilder' }))
    ).toBe('components');
  });

  it('routes MESSAGE_OPTION_KEYS members with no builder receiver to message-options', () => {
    expect(classify(hit({ kind: 'option-key', symbolName: 'content' }))).toBe('message-options');
  });

  it('routes generic keys with no builder receiver to unclassified', () => {
    expect(classify(hit({ kind: 'option-key', symbolName: 'name' }))).toBe('unclassified');
  });

  it('routes non-webhook non-builder option keys with a resolved receiver by the vocabulary', () => {
    expect(
      classify(
        hit({
          kind: 'option-key',
          symbolName: 'content',
          receiverTypeName: 'ChatInputCommandInteraction',
        })
      )
    ).toBe('message-options');
    expect(
      classify(
        hit({
          kind: 'option-key',
          symbolName: 'mystery',
          receiverTypeName: 'ChatInputCommandInteraction',
        })
      )
    ).toBe('unclassified');
  });

  it('routes option keys with an unresolvable receiver and a generic key to unclassified', () => {
    expect(classify(hit({ kind: 'option-key', symbolName: 'weird' }))).toBe('unclassified');
  });

  it('routes every interaction ack method to interaction-acks', () => {
    for (const method of ['reply', 'showModal', 'respond', 'deferUpdate', 'deleteReply']) {
      expect(classify(hit({ kind: 'call', symbolName: method }))).toBe('interaction-acks');
    }
  });

  it('routes command option chain methods to command-options', () => {
    expect(classify(hit({ kind: 'call', symbolName: 'addStringOption' }))).toBe('command-options');
    expect(classify(hit({ kind: 'call', symbolName: 'setAutocomplete' }))).toBe('command-options');
  });

  it('routes command option method property reads to command-options', () => {
    expect(classify(hit({ kind: 'property-access', symbolName: 'addIntegerOption' }))).toBe(
      'command-options'
    );
  });

  it('routes plain discord.js member accesses to client-methods', () => {
    expect(classify(hit({ kind: 'property-access', symbolName: 'send' }))).toBe('client-methods');
  });

  it('routes unknown member accesses to client-methods (the open-ended remainder)', () => {
    expect(classify(hit({ kind: 'property-access', symbolName: 'someBrandNewMethod' }))).toBe(
      'client-methods'
    );
  });

  it('routes message-builder class-name call and property-access sites to message-builders', () => {
    expect(classify(hit({ kind: 'call', symbolName: 'EmbedBuilder' }))).toBe('message-builders');
    expect(classify(hit({ kind: 'property-access', symbolName: 'AttachmentBuilder' }))).toBe(
      'message-builders'
    );
  });

  it('reaches every classify-reachable category; rest-outside-helpers is the analyzer override', () => {
    // classify() itself produces 11 of the 12 categories; `rest-outside-helpers`
    // is assigned by the analyzer's URL check (asserted in analyzer.test.ts).
    const reachable = new Set<SurfaceCategory>();
    const samples: ClassifiableHit[] = [
      hit({ kind: 'property-access', symbolName: 'send' }),
      hit({ kind: 'call', symbolName: 'addStringOption' }),
      hit({ kind: 'new', symbolName: 'ButtonBuilder' }),
      hit({ kind: 'enum-member', symbolName: 'Primary', containerName: 'ButtonStyle' }),
      hit({ kind: 'enum-member', symbolName: 'Ephemeral', containerName: 'MessageFlags' }),
      hit({ kind: 'enum-member', symbolName: 'MessageCreate', containerName: 'Events' }),
      hit({ kind: 'call', symbolName: 'reply' }),
      hit({ kind: 'new', symbolName: 'EmbedBuilder' }),
      hit({ kind: 'option-key', symbolName: 'content' }),
      hit({ kind: 'new', symbolName: 'UnmappedClass' }),
      hit({ kind: 'option-key', symbolName: 'username', receiverTypeName: 'Webhook' }),
    ];
    for (const sample of samples) reachable.add(classify(sample));
    expect(reachable.size).toBe(11);
    expect(reachable.has('rest-outside-helpers')).toBe(false);
    expect(reachable.has('unclassified')).toBe(true);
  });
});
