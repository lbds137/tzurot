/**
 * Tests for the Components-V2 character view renderer (D17 pilot).
 *
 * Assertions run over `toJSON()` so discord.js's own component validation
 * participates in every case.
 */

import { describe, it, expect } from 'vitest';
import { ComponentType } from 'discord.js';
import type { CharacterData } from './characterTypes.js';
import { buildCharacterViewV2, buildViewV2Notice, viewAvatarUrl } from './viewV2.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import { toCharacterData } from './api.js';

function createTestCharacter(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    id: 'test-id',
    name: 'Test Character',
    displayName: null,
    slug: 'test-character',
    characterInfo: 'Test background info',
    personalityTraits: 'Test traits',
    personalityTone: null,
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    errorMessage: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    isPublic: false,
    definitionPublic: false,
    definitionRedacted: false,
    voiceEnabled: false,
    hasVoiceReference: false,
    imageEnabled: false,
    ownerId: 'owner-123',
    avatarData: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as CharacterData;
}

interface ComponentNode {
  type: number;
  components?: ComponentNode[];
  accessory?: { type: number; custom_id?: string; media?: { url: string } };
  content?: string;
  custom_id?: string;
  disabled?: boolean;
}

function toTree(result: ReturnType<typeof buildCharacterViewV2>): ComponentNode[] {
  return result.components.map(c => c.toJSON() as unknown as ComponentNode);
}

/** Flatten every node in the tree for content/type searches. */
function flatten(nodes: ComponentNode[]): ComponentNode[] {
  const out: ComponentNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.components !== undefined) {
      out.push(...flatten(node.components));
    }
    if (node.accessory !== undefined) {
      out.push(node.accessory as ComponentNode);
    }
  }
  return out;
}

describe('viewAvatarUrl', () => {
  it('returns null when the API provides no avatar URL', () => {
    expect(viewAvatarUrl(createTestCharacter({ avatarUrl: null }))).toBeNull();
    expect(viewAvatarUrl(createTestCharacter())).toBeNull();
  });

  it('returns the API-provided public URL verbatim — never rebuilds it locally', () => {
    // The URL must be gateway-derived: bot-client's own GATEWAY_URL is the
    // internal hostname, and a URL built from it rendered as a broken image
    // (Discord's media proxy is the fetcher, not the bot).
    expect(
      viewAvatarUrl(
        createTestCharacter({ avatarUrl: 'https://public.example/avatars/test-character-123.png' })
      )
    ).toBe('https://public.example/avatars/test-character-123.png');
  });

  it('carries the avatar URL through the REAL read-path coercion (avatarUrl survives, avatarData does not)', () => {
    // The seam that broke twice: toCharacterData ALWAYS nulls avatarData on
    // reads, and a schema-undeclared field would be strip-deleted before the
    // bot ever saw it. Pin the wiring through the real coercion.
    const withAvatar = toCharacterData({
      ...createTestCharacter(),
      avatarUrl: 'https://public.example/avatars/test-character-123.png',
    });
    expect(withAvatar.avatarData).toBeNull();
    expect(viewAvatarUrl(withAvatar)).toBe('https://public.example/avatars/test-character-123.png');

    const without = toCharacterData({ ...createTestCharacter(), avatarUrl: null });
    expect(viewAvatarUrl(without)).toBeNull();
  });
});

describe('buildCharacterViewV2', () => {
  it('renders page 0 with an avatar as a header Section + Thumbnail accessory', () => {
    const tree = toTree(
      buildCharacterViewV2(
        createTestCharacter({ hasAvatar: true }),
        0,
        'https://gateway.example/avatars/test-character.png'
      )
    );

    const container = tree[0];
    expect(container.type).toBe(ComponentType.Container);
    const headerSection = container.components?.find(c => c.type === ComponentType.Section);
    expect(headerSection?.accessory?.type).toBe(ComponentType.Thumbnail);
    expect(headerSection?.accessory?.media?.url).toBe(
      'https://gateway.example/avatars/test-character.png'
    );
  });

  it('renders a plain title (no Section) when there is no avatar', () => {
    const tree = toTree(buildCharacterViewV2(createTestCharacter(), 0, null));

    const flat = flatten(tree);
    // No thumbnail anywhere, but the title text still renders
    expect(flat.some(n => n.type === ComponentType.Thumbnail)).toBe(false);
    expect(
      flat.some(n => n.content?.includes('Test Character') === true && n.content.includes('👁️'))
    ).toBe(true);
  });

  it('gives a truncated expandable field its own Section with a 📖 accessory carrying the REAL expand customId', () => {
    const longInfo = 'x'.repeat(2000); // over the 1024-cap default
    const tree = toTree(
      buildCharacterViewV2(createTestCharacter({ characterInfo: longInfo }), 1, null)
    );

    const flat = flatten(tree);
    const section = flat.find(
      n => n.type === ComponentType.Section && n.accessory?.type === ComponentType.Button
    );
    expect(section).toBeDefined();
    // Drift pin: the accessory carries the byte-identical customId the
    // existing expand router matches on.
    expect(section?.accessory?.custom_id).toBe(
      CharacterCustomIds.expand('test-character', 'characterInfo')
    );
    // The truncated marker rides in the section's text
    expect(section?.components?.[0]?.content).toContain('(truncated)');
  });

  it('renders non-truncated fields as plain TextDisplay (no accessory)', () => {
    const tree = toTree(buildCharacterViewV2(createTestCharacter(), 1, null));

    const flat = flatten(tree);
    expect(flat.some(n => n.type === ComponentType.Section)).toBe(false);
    expect(flat.some(n => n.content?.includes('Character Info') === true)).toBe(true);
  });

  it('keeps the nav row with byte-identical viewPage customIds and correct disabled states', () => {
    const tree = toTree(buildCharacterViewV2(createTestCharacter(), 0, null));

    const nav = tree[1];
    expect(nav.type).toBe(ComponentType.ActionRow);
    const [prev, info, next] = nav.components ?? [];
    expect(prev.custom_id).toBe(CharacterCustomIds.viewPage('test-character', -1));
    expect(prev.disabled).toBe(true); // page 0
    expect(info.disabled).toBe(true);
    expect(next.custom_id).toBe(CharacterCustomIds.viewPage('test-character', 1));
    expect(next.disabled).toBe(false);
  });

  it('disables Next on the last page', () => {
    const tree = toTree(buildCharacterViewV2(createTestCharacter(), 3, null));
    const nav = tree[1];
    const next = nav.components?.[2];
    expect(next?.disabled).toBe(true);
  });

  it('renders the redacted variant as a single Container with no interactive components', () => {
    const tree = toTree(
      buildCharacterViewV2(createTestCharacter({ definitionRedacted: true }), 0, null)
    );

    expect(tree).toHaveLength(1);
    const flat = flatten(tree);
    expect(flat.some(n => n.type === ComponentType.Button)).toBe(false);
    expect(flat.some(n => n.type === ComponentType.Section)).toBe(false);
    expect(flat.some(n => n.content?.includes('definition is private') === true)).toBe(true);
  });

  it('renders Tone and Age as separate blocks, never one joined line (owner eval finding)', () => {
    const flat = flatten(
      toTree(
        buildCharacterViewV2(
          createTestCharacter({
            personalityTone: 'a very long tone paragraph that would scrunch anything joined to it',
            personalityAge: 'sounds about fifty',
          }),
          0,
          null
        )
      )
    );

    const toneNode = flat.find(n => n.content?.startsWith('**🎨 Tone**') === true);
    const ageNode = flat.find(n => n.content?.startsWith('**📅 Age**') === true);
    expect(toneNode?.content).toContain('a very long tone paragraph');
    expect(ageNode?.content).toContain('sounds about fifty');
    // Age must not ride the tail of the Tone block.
    expect(toneNode?.content).not.toContain('Age');
  });

  it('carries the date footer as subtext on every page', () => {
    for (const page of [0, 1, 2, 3]) {
      const flat = flatten(toTree(buildCharacterViewV2(createTestCharacter(), page, null)));
      expect(flat.some(n => n.content?.startsWith('-# Created:') === true)).toBe(true);
    }
  });

  it('clamps out-of-range pages instead of throwing', () => {
    const tree = toTree(buildCharacterViewV2(createTestCharacter(), 99, null));
    const flat = flatten(tree);
    // Clamped to the last page (Conversation)
    expect(flat.some(n => n.content?.includes('Conversation') === true)).toBe(true);
  });
});

describe('buildViewV2Notice', () => {
  it('ships plain text as a Container TextDisplay with no interactive components', () => {
    const result = buildViewV2Notice('❌ Character not found.');

    expect(result.components).toHaveLength(1);
    const flat = flatten(toTree(result));
    expect(flat.some(n => n.content?.includes('Character not found') === true)).toBe(true);
    expect(flat.some(n => n.type === ComponentType.Button)).toBe(false);
  });
});
