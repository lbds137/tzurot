/**
 * Seam test: ContextStep → buildConversationContext → PromptBuilder.
 *
 * The recent-days digest is fetched (and render-gated) in one pipeline step
 * and rendered two hops later, and every hop between them is a plain field
 * copy onto a shared context object. That is the shared-mutable-context seam
 * from `02-code-standards.md` § "Assert what crosses a mocked seam": each
 * hop's own unit tests construct the context themselves, so none of them can
 * observe what the previous hop actually produced. A dropped
 * `recentDaysDigest` in the builder, or a key mismatch between the fetch and
 * the renderer, would leave every one of those suites green while the
 * feature silently rendered nothing — which is also its correct degraded
 * state, so nothing would look broken.
 *
 * Only the DB boundary is mocked. The setting checks, the render gate, the
 * field copies, and the XML rendering all run for real, which is the point.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { ContextStep } from './ContextStep.js';
import { buildConversationContext } from './conversationContextBuilder.js';
import { PromptBuilder } from '../../../../services/PromptBuilder.js';
import type { GenerationContext, ResolvedConfig } from '../types.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

const settingsState = vi.hoisted(() => ({
  recentDaysDigestEnabled: true,
  recentDaysDigestPersonalities: ['lilith'] as string[],
}));

vi.mock('@tzurot/common-types/services/SystemSettingsService', () => ({
  getSystemSetting: (key: string) =>
    key in settingsState ? settingsState[key as keyof typeof settingsState] : undefined,
}));

const RESPONDER: LoadedPersonality = {
  id: 'p-lilith',
  name: 'Lilith',
  displayName: 'Lilith',
  slug: 'lilith',
  ownerId: 'owner-1',
  systemPrompt: 'You are Lilith.',
  model: 'anthropic/claude-sonnet-4',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  characterInfo: 'A test personality',
  personalityTraits: 'Wry',
  voiceEnabled: false,
};

const config = { effectivePersonality: RESPONDER, configSource: 'personality' } as ResolvedConfig;

const HISTORY = [
  { role: MessageRole.User, content: 'hey', personaId: 'persona-1', personaName: 'Alice' },
];

function job(): Job<LLMGenerationJobData> {
  return {
    id: 'job-1',
    timestamp: Date.now(),
    data: {
      requestId: 'req-1',
      jobType: JobType.LLMGeneration,
      personality: RESPONDER,
      message: 'hey',
      context: { kind: 'envelope', userId: 'u-1', rawAssemblyInputs: { rawMessageContent: 'hey' } },
    },
  } as unknown as Job<LLMGenerationJobData>;
}

interface AssembleCoreOverrides {
  activePersonaId?: string | null;
  contextEpoch?: Date | undefined;
}

/** Run the real chain, mocking only the DB read, and return the volatile prefix. */
async function renderThroughChain(
  getRecentDaysDigest: ReturnType<typeof vi.fn>,
  overrides: AssembleCoreOverrides = {}
): Promise<string> {
  const assembleCore = vi.fn().mockResolvedValue({
    userInternalId: 'uid',
    activePersonaId: 'persona-1',
    activePersonaName: 'Alice',
    userTimezone: 'UTC',
    contextEpoch: undefined,
    history: HISTORY,
    referencedMessages: undefined,
    messageContent: 'hey',
    mentionedPersonas: undefined,
    referencedChannels: undefined,
    crossChannelHistory: undefined,
    participantGuildInfo: undefined,
    activePersonaGuildInfo: undefined,
    ...overrides,
  });
  const step = new ContextStep({ assembleCore } as never, { getRecentDaysDigest } as never);

  const theJob = job();
  const result = await step.process({ job: theJob, config } as unknown as GenerationContext);
  const preparedContext = result.preparedContext;
  if (preparedContext === undefined) {
    throw new Error('ContextStep produced no prepared context');
  }

  const conversationContext = buildConversationContext(
    theJob.data.context,
    preparedContext,
    undefined,
    'req-1'
  );

  return new PromptBuilder().buildVolatilePrefix({
    personality: RESPONDER,
    context: conversationContext,
  });
}

describe('recent-days digest seam: fetch+gate in ContextStep → render in PromptBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.recentDaysDigestEnabled = true;
    settingsState.recentDaysDigestPersonalities = ['lilith'];
  });

  it('renders the digest inside <recent_days> when the row is in-window with a matching epoch', async () => {
    const getRecentDaysDigest = vi.fn().mockResolvedValue({
      text: 'DIGEST SENTINEL 9c1e',
      generatedAt: new Date(),
      sourceEpoch: null,
    });

    const prefix = await renderThroughChain(getRecentDaysDigest);

    expect(prefix).toContain('<recent_days usage="continuity_do_not_recite">');
    expect(prefix).toContain('DIGEST SENTINEL 9c1e');
    expect(prefix).toContain('</recent_days>');
  });

  it('omits <recent_days> and still renders the rest of the prefix when the row is null', async () => {
    const getRecentDaysDigest = vi.fn().mockResolvedValue(null);

    const prefix = await renderThroughChain(getRecentDaysDigest);

    expect(prefix).not.toContain('<recent_days');
    expect(prefix).toContain('<context>');
  });

  it('omits <recent_days> when the stored epoch does not match the assembled context epoch', async () => {
    const t = new Date('2026-09-01T00:00:00.000Z').getTime();
    const getRecentDaysDigest = vi.fn().mockResolvedValue({
      text: 'DIGEST SENTINEL',
      generatedAt: new Date(),
      sourceEpoch: new Date(t),
    });

    const prefix = await renderThroughChain(getRecentDaysDigest, {
      contextEpoch: new Date(t + 1000),
    });

    expect(prefix).not.toContain('<recent_days');
  });

  it('does not call getRecentDaysDigest when the feature switch is off', async () => {
    settingsState.recentDaysDigestEnabled = false;
    const getRecentDaysDigest = vi.fn().mockResolvedValue({
      text: 'DIGEST SENTINEL',
      generatedAt: new Date(),
      sourceEpoch: null,
    });

    const prefix = await renderThroughChain(getRecentDaysDigest);

    expect(getRecentDaysDigest).not.toHaveBeenCalled();
    expect(prefix).not.toContain('<recent_days');
  });

  it('does not call getRecentDaysDigest when the slug is not in the allowlist', async () => {
    settingsState.recentDaysDigestPersonalities = ['someone-else'];
    const getRecentDaysDigest = vi.fn().mockResolvedValue({
      text: 'DIGEST SENTINEL',
      generatedAt: new Date(),
      sourceEpoch: null,
    });

    const prefix = await renderThroughChain(getRecentDaysDigest);

    expect(getRecentDaysDigest).not.toHaveBeenCalled();
    expect(prefix).not.toContain('<recent_days');
  });

  it('does not call getRecentDaysDigest for an incognito summon', async () => {
    const getRecentDaysDigest = vi.fn().mockResolvedValue({
      text: 'DIGEST SENTINEL',
      generatedAt: new Date(),
      sourceEpoch: null,
    });

    const prefix = await renderThroughChain(getRecentDaysDigest, { activePersonaId: null });

    expect(getRecentDaysDigest).not.toHaveBeenCalled();
    expect(prefix).not.toContain('<recent_days');
  });
});
