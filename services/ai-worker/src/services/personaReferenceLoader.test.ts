/**
 * Tests for personaReferenceLoader
 *
 * Verifies the persona-load step delegates to MemoryRetriever (participant
 * personas) and UserReferenceResolver (static-field reference resolution) and
 * returns the combined shape the orchestrator consumes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPersonasAndResolveReferences } from './personaReferenceLoader.js';
import type { MemoryRetriever } from './MemoryRetriever.js';
import type { UserReferenceResolver } from './UserReferenceResolver.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { ConversationContext } from './ConversationalRAGTypes.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const personality: LoadedPersonality = {
  id: 'personality-1',
  slug: 'test-bot',
  ownerId: 'owner-uuid',
  name: 'TestBot',
  displayName: 'Test Bot',
  systemPrompt: 'You are a test bot',
  characterInfo: 'Test character',
  personalityTraits: 'Helpful',
  model: 'gpt-4',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8000,
  voiceEnabled: false,
};

const context: ConversationContext = {
  userId: 'user-1',
  channelId: 'channel-1',
  serverId: 'server-1',
};

describe('loadPersonasAndResolveReferences', () => {
  let mockGetAllParticipantPersonas: ReturnType<typeof vi.fn>;
  let mockResolvePersonalityReferences: ReturnType<typeof vi.fn>;
  let memoryRetriever: MemoryRetriever;
  let userReferenceResolver: UserReferenceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllParticipantPersonas = vi.fn();
    mockResolvePersonalityReferences = vi.fn();
    memoryRetriever = {
      getAllParticipantPersonas: mockGetAllParticipantPersonas,
    } as unknown as MemoryRetriever;
    userReferenceResolver = {
      resolvePersonalityReferences: mockResolvePersonalityReferences,
    } as unknown as UserReferenceResolver;
  });

  it('returns the participant personas and the reference-resolved personality', async () => {
    const participantPersonas = new Map([['Lila', { content: 'persona content' }]]);
    mockGetAllParticipantPersonas.mockResolvedValue(participantPersonas);
    const processedPersonality = { ...personality, systemPrompt: 'resolved' };
    mockResolvePersonalityReferences.mockResolvedValue({
      resolvedPersonality: processedPersonality,
      resolvedPersonas: [{ name: 'Lila' }],
    });

    const result = await loadPersonasAndResolveReferences(
      memoryRetriever,
      userReferenceResolver,
      personality,
      context
    );

    expect(mockGetAllParticipantPersonas).toHaveBeenCalledWith(context, personality.id);
    expect(mockResolvePersonalityReferences).toHaveBeenCalledWith(personality);
    expect(result.participantPersonas).toBe(participantPersonas);
    expect(result.processedPersonality).toBe(processedPersonality);
  });

  it('handles the empty case (no participants, no resolved references)', async () => {
    mockGetAllParticipantPersonas.mockResolvedValue(new Map());
    mockResolvePersonalityReferences.mockResolvedValue({
      resolvedPersonality: personality,
      resolvedPersonas: [],
    });

    const result = await loadPersonasAndResolveReferences(
      memoryRetriever,
      userReferenceResolver,
      personality,
      context
    );

    expect(result.participantPersonas.size).toBe(0);
    expect(result.processedPersonality).toBe(personality);
  });
});
