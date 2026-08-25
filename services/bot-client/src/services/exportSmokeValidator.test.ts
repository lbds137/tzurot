/**
 * Tests for the export-smoke validator's top-level orchestration:
 * zip-opening, directory-failure fallthrough, and the no-content-leak
 * security guarantee.
 */

import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { validateExportArtifact } from './exportSmokeValidator.js';
import type { ExportSmokeExpectedCounts } from './exportSmokeValidator.js';

const PERSONALITY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PERSONA_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const ISO = '2026-01-01T00:00:00.000Z';

const EXPECTED_COUNTS: ExportSmokeExpectedCounts = {
  personas: [{ id: PERSONA_ID, name: 'Persona One' }],
  characters: [{ id: PERSONALITY_ID, slug: 'char-one' }],
  conversationCountsByPersonalityId: { [PERSONALITY_ID]: 2 },
  memoryCountsByPersonalityId: { [PERSONALITY_ID]: 1 },
  factCountsByPersonalityId: {},
  totals: { personas: 1, characters: 1, conversations: 2, memories: 1, facts: 0 },
  isSuperuser: false,
};

function personaRow(content: string): unknown {
  return {
    id: PERSONA_ID,
    name: 'Persona One',
    description: null,
    content,
    preferredName: null,
    pronouns: null,
    ownerId: 'owner-1',
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function characterRow(): unknown {
  return {
    id: PERSONALITY_ID,
    name: 'Char One',
    displayName: null,
    slug: 'char-one',
    systemPromptId: null,
    ownerId: 'owner-1',
    characterInfo: 'info',
    personalityTraits: 'traits',
    personalityTone: null,
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    customFields: null,
    errorMessage: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    isPublic: false,
    definitionPublic: false,
    voiceEnabled: false,
    voiceSettings: null,
    imageEnabled: false,
    imageSettings: null,
    voiceReferenceType: null,
    configDefaults: null,
    originalOwnerDiscordId: null,
    tags: [],
    rosterBlurb: null,
    rosterBlurbSourceHash: null,
    cardSourceHash: null,
    rosterBlurbAttempts: 0,
    rosterBlurbLastFailedAt: null,
    rosterBlurbFailedSourceHash: null,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function conversationRow(id: string): unknown {
  return {
    id,
    channelId: 'chan-1',
    guildId: null,
    personalityId: PERSONALITY_ID,
    personaId: PERSONA_ID,
    role: 'user',
    content: 'hello',
    tokenCount: null,
    discordMessageId: [],
    messageMetadata: null,
    thinkingContent: null,
    deletedAt: null,
    editedAt: null,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function memoryRow(content: string): unknown {
  return {
    id: 'mem-1',
    personaId: PERSONA_ID,
    personalityId: PERSONALITY_ID,
    content,
    isSummarized: false,
    originalMessageCount: null,
    summarizedAt: null,
    sessionId: null,
    canonScope: null,
    summaryType: null,
    channelId: null,
    guildId: null,
    messageIds: [],
    senders: [],
    createdAt: ISO,
    updatedAt: ISO,
    legacyShapesUserId: null,
    sourceSystem: 'native',
    type: 'episodic',
    isLocked: false,
    visibility: 'private',
    pool: 'default',
    canonGroupId: null,
    isFiction: false,
    chunkGroupId: null,
    chunkIndex: null,
    totalChunks: null,
  };
}

function profileRow(): unknown {
  return {
    discordId: 'discord-1',
    username: 'user',
    timezone: 'UTC',
    nsfwVerified: false,
    nsfwVerifiedAt: null,
    notifyEnabled: true,
    notifyLevel: 'minor',
    createdAt: ISO,
    configDefaults: null,
  };
}

/** A complete, schema-valid export artifact matching EXPECTED_COUNTS. */
function buildBaselineFiles(personaContent = 'persona content', memoryContent = 'memory content') {
  const files: Record<string, Uint8Array> = {
    'README.md': strToU8('Export readme'),
    'personality-directory.json': strToU8(
      JSON.stringify([{ id: PERSONALITY_ID, name: 'Char One', slug: 'char-one' }])
    ),
    'profile.json': strToU8(JSON.stringify(profileRow())),
    'profile.md': strToU8('Profile'),
    'feedback.json': strToU8('[]'),
    'feedback.md': strToU8('Feedback'),
    'usage-summary.json': strToU8('[]'),
    'usage-summary.md': strToU8('Usage summary'),
    'configs/llm.json': strToU8('[]'),
    'configs/tts.json': strToU8('[]'),
    'configs/personality-overrides.json': strToU8('[]'),
    'configs/persona-history.json': strToU8('[]'),
    'configs/user-defaults.json': strToU8('null'),
    'account/api-key-metadata.json': strToU8('[]'),
    'account/credential-metadata.json': strToU8('[]'),
    'account/jobs.json': strToU8(JSON.stringify({ importJobs: [], exportJobs: [] })),
    'account/release-deliveries.json': strToU8('[]'),
    'account/shapes-mappings.json': strToU8('[]'),
    'telemetry/command-events.json': strToU8('[]'),
    'personas/Persona_One-bbbbbbbb.json': strToU8(JSON.stringify(personaRow(personaContent))),
    'personas/Persona_One-bbbbbbbb.md': strToU8('Persona'),
    'characters/char-one.json': strToU8(JSON.stringify(characterRow())),
    'characters/char-one.md': strToU8('Character'),
    'conversations/char-one.json': strToU8(
      JSON.stringify([conversationRow('conv-1'), conversationRow('conv-2')])
    ),
    'conversations/char-one.md': strToU8('Conversations'),
    'memories/char-one.json': strToU8(JSON.stringify([memoryRow(memoryContent)])),
    'memories/char-one.md': strToU8('Memories'),
  };
  return files;
}

describe('validateExportArtifact', () => {
  it('reports ok:true with no findings for a fully valid artifact', () => {
    const zipped = zipSync(buildBaselineFiles());
    const result = validateExportArtifact(zipped, EXPECTED_COUNTS);
    expect(result).toEqual({ ok: true, findings: [] });
  });

  it('CANARY: reports a finding and does NOT throw for a corrupt zip', () => {
    const corrupt = strToU8('this is not a zip archive');
    const result = validateExportArtifact(corrupt, EXPECTED_COUNTS);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(['zip: archive could not be opened']);
  });

  it('reports a finding and does NOT throw for empty input', () => {
    const result = validateExportArtifact(new Uint8Array(0), EXPECTED_COUNTS);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(['zip: archive could not be opened']);
  });

  it('still runs the schema and md checks when the directory itself fails', () => {
    const files = buildBaselineFiles();
    delete files['personality-directory.json'];
    // Also break an unrelated json file, unconditional on the directory,
    // to prove that check keeps running past a directory-stage failure.
    files['feedback.json'] = strToU8('not json');
    const zipped = zipSync(files);
    const result = validateExportArtifact(zipped, EXPECTED_COUNTS);
    expect(result.ok).toBe(false);
    expect(result.findings).toContain('manifest: personality-directory.json is missing');
    expect(result.findings).toContain('json-parse: feedback.json failed to parse');
  });

  it('never leaks exported user text into a finding', () => {
    const secret = 'sk-topsecret-user-content-value';
    const files = buildBaselineFiles(secret, secret);
    // Force at least one finding so the negative assertion below is
    // meaningful — an always-empty findings array would pass trivially.
    files['configs/llm.json'] = strToU8(JSON.stringify([{ bogusKey: secret }]));
    const zipped = zipSync(files);
    const result = validateExportArtifact(zipped, EXPECTED_COUNTS);
    expect(result.ok).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.join('\n')).not.toContain(secret);
  });
});
