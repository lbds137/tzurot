/**
 * Tests for SlotResolver — the pure-function core of multi-tag slot ordering.
 */

import { describe, it, expect } from 'vitest';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import { pickNewDMActivePersonality, resolveSlots } from './SlotResolver.js';

// Build a minimal LoadedPersonality fixture by name. Tests only care about
// id, name, slug; other fields are filled with stub values.
function p(name: string): LoadedPersonality {
  return {
    id: `id-${name}`,
    name,
    displayName: name,
    slug: name.toLowerCase(),
    ownerId: 'owner-1',
    systemPrompt: '',
    model: 'mock',
    provider: 'openrouter',
    temperature: 0.8,
    contextWindowTokens: 131072,
    characterInfo: '',
    personalityTraits: '',
  } as unknown as LoadedPersonality;
}

describe('SlotResolver', () => {
  describe('resolveSlots — basic ordering', () => {
    it('returns an empty array when no inputs are provided', () => {
      expect(resolveSlots({})).toEqual([]);
    });

    it('returns reply alone as slot 0 with source=reply, isAutoResponse=false', () => {
      const slots = resolveSlots({ replyPersonality: p('Alice') });
      expect(slots).toHaveLength(1);
      expect(slots[0]).toMatchObject({
        personality: { name: 'Alice' },
        source: 'reply',
        isAutoResponse: false,
      });
    });

    it('returns activation alone as slot 0 with source=activation, isAutoResponse=true', () => {
      const slots = resolveSlots({ activatedPersonality: p('Alice') });
      expect(slots).toHaveLength(1);
      expect(slots[0]).toMatchObject({
        source: 'activation',
        isAutoResponse: true,
      });
    });

    it('returns dm-session alone as slot 0 with source=dm-session, isAutoResponse=true', () => {
      const slots = resolveSlots({ dmSessionPersonality: p('Alice') });
      expect(slots).toHaveLength(1);
      expect(slots[0]).toMatchObject({
        source: 'dm-session',
        isAutoResponse: true,
      });
    });

    it('returns mentions in textual order', () => {
      const slots = resolveSlots({ mentionedPersonalities: [p('A'), p('B'), p('C')] });
      expect(slots.map(s => s.personality.name)).toEqual(['A', 'B', 'C']);
      expect(slots.every(s => s.source === 'mention')).toBe(true);
      expect(slots.every(s => s.isAutoResponse === false)).toBe(true);
    });
  });

  describe('resolveSlots — combined sources', () => {
    it('combines reply + activation + mentions in slot order', () => {
      const slots = resolveSlots({
        replyPersonality: p('Reply'),
        activatedPersonality: p('Activated'),
        mentionedPersonalities: [p('M1'), p('M2')],
      });
      expect(slots.map(s => s.personality.name)).toEqual(['Reply', 'Activated', 'M1', 'M2']);
      expect(slots.map(s => s.source)).toEqual(['reply', 'activation', 'mention', 'mention']);
    });

    it('combines reply + dm-session + mentions in slot order', () => {
      const slots = resolveSlots({
        replyPersonality: p('Reply'),
        dmSessionPersonality: p('DM'),
        mentionedPersonalities: [p('M1')],
      });
      expect(slots.map(s => s.personality.name)).toEqual(['Reply', 'DM', 'M1']);
      expect(slots.map(s => s.source)).toEqual(['reply', 'dm-session', 'mention']);
    });

    it('prefers activation over dm-session when both are provided', () => {
      // Practically mutually exclusive by channel type, but defensive coding:
      // activation wins.
      const slots = resolveSlots({
        activatedPersonality: p('A'),
        dmSessionPersonality: p('D'),
      });
      expect(slots).toHaveLength(1);
      expect(slots[0].source).toBe('activation');
    });
  });

  describe('resolveSlots — deduplication', () => {
    it('dedupes when reply and activation are the same personality', () => {
      const same = p('Same');
      const slots = resolveSlots({
        replyPersonality: same,
        activatedPersonality: same,
      });
      expect(slots).toHaveLength(1);
      // Reply slot wins (first occurrence).
      expect(slots[0].source).toBe('reply');
    });

    it('dedupes when reply is also in mentions', () => {
      const alice = p('Alice');
      const slots = resolveSlots({
        replyPersonality: alice,
        mentionedPersonalities: [alice, p('Bob')],
      });
      expect(slots).toHaveLength(2);
      expect(slots[0]).toMatchObject({ source: 'reply', personality: { name: 'Alice' } });
      expect(slots[1]).toMatchObject({ source: 'mention', personality: { name: 'Bob' } });
    });

    it('dedupes within the mention list itself', () => {
      const alice = p('Alice');
      const slots = resolveSlots({
        mentionedPersonalities: [alice, alice, p('Bob')],
      });
      expect(slots).toHaveLength(2);
      expect(slots.map(s => s.personality.name)).toEqual(['Alice', 'Bob']);
    });
  });

  describe('resolveSlots — cap', () => {
    it('caps at MULTI_TAG.MAX_TAGS by default', () => {
      const mentions = Array.from({ length: 7 }, (_, i) => p(`M${i}`));
      const slots = resolveSlots({ mentionedPersonalities: mentions });
      expect(slots).toHaveLength(MULTI_TAG.MAX_TAGS);
      expect(slots.map(s => s.personality.name)).toEqual(['M0', 'M1', 'M2', 'M3', 'M4']);
    });

    it('cap includes reply + activation, leaving fewer mention slots', () => {
      const mentions = Array.from({ length: 5 }, (_, i) => p(`M${i}`));
      const slots = resolveSlots({
        replyPersonality: p('R'),
        activatedPersonality: p('A'),
        mentionedPersonalities: mentions,
      });
      expect(slots).toHaveLength(MULTI_TAG.MAX_TAGS);
      // First two slots are reply + activation; remaining 3 are first 3 mentions.
      expect(slots.map(s => s.personality.name)).toEqual(['R', 'A', 'M0', 'M1', 'M2']);
    });

    it('respects a custom cap', () => {
      const slots = resolveSlots({
        mentionedPersonalities: [p('A'), p('B'), p('C')],
        maxTags: 2,
      });
      expect(slots).toHaveLength(2);
      expect(slots.map(s => s.personality.name)).toEqual(['A', 'B']);
    });

    it('returns empty when maxTags is 0', () => {
      const slots = resolveSlots({
        replyPersonality: p('R'),
        mentionedPersonalities: [p('A')],
        maxTags: 0,
      });
      expect(slots).toEqual([]);
    });

    it('handles negative maxTags as zero', () => {
      const slots = resolveSlots({
        replyPersonality: p('R'),
        maxTags: -1,
      });
      expect(slots).toEqual([]);
    });
  });

  describe('resolveSlots — null/undefined handling', () => {
    it('treats null replyPersonality as absent', () => {
      const slots = resolveSlots({
        replyPersonality: null,
        mentionedPersonalities: [p('A')],
      });
      expect(slots).toHaveLength(1);
      expect(slots[0].source).toBe('mention');
    });

    it('treats undefined fields as absent', () => {
      const slots = resolveSlots({
        replyPersonality: undefined,
        activatedPersonality: undefined,
        dmSessionPersonality: undefined,
        mentionedPersonalities: undefined,
      });
      expect(slots).toEqual([]);
    });
  });

  describe('pickNewDMActivePersonality', () => {
    it('returns null for empty slot list', () => {
      expect(pickNewDMActivePersonality([])).toBeNull();
    });

    it('returns the last mention when mentions exist', () => {
      const slots = resolveSlots({
        replyPersonality: p('R'),
        mentionedPersonalities: [p('M1'), p('M2'), p('M3')],
      });
      const winner = pickNewDMActivePersonality(slots);
      expect(winner?.name).toBe('M3');
    });

    it('returns the reply target when no mentions present', () => {
      const slots = resolveSlots({
        replyPersonality: p('R'),
        dmSessionPersonality: p('D'),
      });
      const winner = pickNewDMActivePersonality(slots);
      expect(winner?.name).toBe('R');
    });

    it('returns null when only ambient (dm-session) slot is present', () => {
      const slots = resolveSlots({ dmSessionPersonality: p('D') });
      expect(pickNewDMActivePersonality(slots)).toBeNull();
    });

    it('returns null when only ambient (activation) slot is present', () => {
      const slots = resolveSlots({ activatedPersonality: p('A') });
      expect(pickNewDMActivePersonality(slots)).toBeNull();
    });

    it('returns the last mention even when reply is also present', () => {
      const slots = resolveSlots({
        replyPersonality: p('R'),
        activatedPersonality: p('A'),
        mentionedPersonalities: [p('M1'), p('M2')],
      });
      const winner = pickNewDMActivePersonality(slots);
      expect(winner?.name).toBe('M2');
    });
  });
});
