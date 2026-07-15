import { describe, it, expect } from 'vitest';
import type { AccountExportData } from './AccountExportAssembler.js';
import { buildAccountExportFiles } from './AccountExportFiles.js';

const NOW = new Date('2026-07-15T12:00:00Z');

function makeData(overrides: Partial<AccountExportData> = {}): AccountExportData {
  return {
    meta: { exportedAt: NOW.toISOString(), formatVersion: 2, notes: ['no secrets ever'] },
    profile: {
      username: 'alice',
      discordId: '123456789012345678',
      timezone: null,
      nsfwVerified: false,
      nsfwVerifiedAt: null,
      notifyEnabled: true,
      notifyLevel: 'minor',
      createdAt: NOW,
    },
    personas: [],
    characters: [],
    personalityDirectory: [],
    conversationHistory: [],
    memories: [],
    facts: [],
    personalityConfigs: [],
    personaHistoryConfigs: [],
    llmConfigs: [],
    ttsConfigs: [],
    apiKeyMetadata: [],
    credentialMetadata: [],
    usageSummary: [],
    feedback: [],
    importJobs: [],
    exportJobs: [],
    releaseDeliveries: [],
    shapesMappings: [],
    ...overrides,
  } as AccountExportData;
}

describe('buildAccountExportFiles', () => {
  it('always emits README, directory, profile pair, top-level pairs, and JSON-only sections', () => {
    const files = buildAccountExportFiles(makeData());

    expect(files['README.md']).toContain('# Tzurot Account Export');
    expect(files['README.md']).toContain('no secrets ever');
    expect(files['personality-directory.json']).toBe('[]');
    expect(files['profile.json']).toContain('"username": "alice"');
    expect(files['profile.md']).toContain('# Account Profile');
    expect(files['feedback.json']).toBe('[]');
    expect(files['feedback.md']).toContain('# Feedback');
    expect(files['usage-summary.md']).toContain('# Usage Summary');
    for (const jsonOnly of [
      'configs/llm.json',
      'configs/tts.json',
      'configs/personality-overrides.json',
      'configs/persona-history.json',
      'account/api-key-metadata.json',
      'account/credential-metadata.json',
      'account/jobs.json',
      'account/release-deliveries.json',
      'account/shapes-mappings.json',
    ]) {
      expect(files[jsonOnly]).toBeDefined();
      expect(files[`${jsonOnly.replace('.json', '.md')}`]).toBeUndefined();
    }
  });

  it('writes one json/md pair per persona, stem = sanitized name + id prefix', () => {
    const files = buildAccountExportFiles(
      makeData({
        personas: [
          {
            id: 'aaaabbbb-1111-2222-3333-444444444444',
            name: 'Ny x/…',
            preferredName: null,
            pronouns: null,
            description: null,
            content: 'about',
            ownerId: 'u1',
            createdAt: NOW,
            updatedAt: NOW,
          },
        ] as AccountExportData['personas'],
      })
    );

    expect(files['personas/Ny_x__-aaaabbbb.json']).toContain('"name": "Ny x/…"');
    expect(files['personas/Ny_x__-aaaabbbb.md']).toContain('# Ny x/…');
  });

  it('folders character-scoped sections by directory slug, falling back to unknown-<id8>', () => {
    const files = buildAccountExportFiles(
      makeData({
        personalityDirectory: [{ id: 'char-1', name: 'Azura', slug: 'azura' }],
        memories: [
          {
            id: 'mem-1',
            personalityId: 'char-1',
            content: 'remembered',
            createdAt: NOW,
            isLocked: false,
            visibility: 'normal',
            type: 'memory',
            isSummarized: false,
          },
          {
            id: 'mem-2',
            personalityId: 'feedbeef-0000-0000-0000-000000000000',
            content: 'orphaned',
            createdAt: NOW,
            isLocked: false,
            visibility: 'normal',
            type: 'memory',
            isSummarized: false,
          },
        ] as unknown as AccountExportData['memories'],
      })
    );

    expect(files['memories/azura.json']).toContain('remembered');
    expect(files['memories/azura.md']).toContain('# Memories — Azura');
    expect(files['memories/unknown-feedbeef.json']).toContain('orphaned');
    expect(files['memories/unknown-feedbeef.md']).toContain('# Memories — Unknown character');
  });

  it('uses persona preferred names as transcript speakers', () => {
    const files = buildAccountExportFiles(
      makeData({
        personas: [
          {
            id: 'persona-1',
            name: 'Nyx',
            preferredName: 'Vee',
            pronouns: null,
            description: null,
            content: 'about',
            ownerId: 'u1',
            createdAt: NOW,
            updatedAt: NOW,
          },
        ] as AccountExportData['personas'],
        personalityDirectory: [{ id: 'char-1', name: 'Azura', slug: 'azura' }],
        conversationHistory: [
          {
            id: 'msg-1',
            channelId: 'chan-1',
            guildId: null,
            personalityId: 'char-1',
            personaId: 'persona-1',
            role: 'user',
            content: 'hello',
            createdAt: NOW,
            deletedAt: null,
            editedAt: null,
          },
        ] as unknown as AccountExportData['conversationHistory'],
      })
    );

    expect(files['conversations/azura.md']).toContain('Vee:');
    // Persona files keep the real name even when a preferred name exists.
    expect(files['personas/Nyx-persona-.json']).toBeDefined();
  });

  it('writes character definition pairs keyed by slug', () => {
    const files = buildAccountExportFiles(
      makeData({
        characters: [
          {
            id: 'char-1',
            name: 'azura',
            displayName: 'Azura',
            slug: 'azura',
            isPublic: true,
            createdAt: NOW,
            characterInfo: 'sea spirit',
            personalityTraits: 'calm',
            personalityTone: null,
            personalityAge: null,
            personalityAppearance: null,
            personalityLikes: null,
            personalityDislikes: null,
            conversationalGoals: null,
            conversationalExamples: null,
          },
        ] as unknown as AccountExportData['characters'],
      })
    );

    expect(files['characters/azura.json']).toContain('"slug": "azura"');
    expect(files['characters/azura.md']).toContain('sea spirit');
    expect(files['README.md']).toContain('**Characters (owned or co-owned):** 1');
  });
});
