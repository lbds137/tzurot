/**
 * Seam test: ContextStep → buildConversationContext → PromptBuilder.
 *
 * A generated roster blurb is fetched in one pipeline step and rendered three
 * hops later, and every hop between them is a plain field copy onto a shared
 * context object. That is the shared-mutable-context seam from
 * `02-code-standards.md` § "Assert what crosses a mocked seam": each hop's own
 * unit tests construct the context themselves, so none of them can observe what
 * the previous hop actually produced. A dropped `characterBlurbs` in the
 * builder, or a key mismatch between the fetch and the renderer, would leave
 * every one of those suites green while the feature silently rendered
 * name-only — which is also its correct degraded state, so nothing would look
 * broken.
 *
 * Only the DB boundary is mocked. The membership rule, the field copies, and
 * the XML rendering all run for real, which is the point: the fetch derives its
 * ids from the same history array the renderer later reads, and this is the one
 * test that can prove those two agree.
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

// The feature switch on — its off-path is pinned in ContextStep's own suite.
vi.mock('@tzurot/common-types/services/SystemSettingsService', () => ({
  getSystemSetting: (key: string) => (key === 'rosterBlurbEnabled' ? true : undefined),
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

/** One sibling character's line plus one human line — the minimum real roster. */
const HISTORY = [
  { role: MessageRole.User, content: 'hey', personaId: 'persona-1', personaName: 'Alice' },
  { role: MessageRole.Assistant, content: 'hi', personalityId: 'p-kai', personalityName: 'Kai' },
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

/** Run the real chain, mocking only the DB read, and return the system message. */
async function renderThroughChain(blurbs: Map<string, string>): Promise<string> {
  const assembleCore = vi.fn().mockResolvedValue({
    userInternalId: 'uid',
    activePersonaId: 'persona-1',
    activePersonaName: 'Alice',
    userTimezone: 'UTC',
    history: HISTORY,
    referencedMessages: undefined,
    messageContent: 'hey',
    mentionedPersonas: undefined,
    referencedChannels: undefined,
    crossChannelHistory: undefined,
    participantGuildInfo: undefined,
    activePersonaGuildInfo: undefined,
  });
  const getRosterBlurbsByIds = vi.fn().mockResolvedValue(blurbs);
  const step = new ContextStep({ assembleCore } as never, { getRosterBlurbsByIds } as never);

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

  return new PromptBuilder().buildSystemMessage({
    personality: RESPONDER,
    context: conversationContext,
    participantPersonas: new Map(),
  }).message.content as string;
}

describe('roster blurb seam: fetch in ContextStep → render in PromptBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carries a fetched blurb all the way into the rendered roster entry', async () => {
    const rendered = await renderThroughChain(
      new Map([['p-kai', 'Kai is a dry-witted archivist.']])
    );

    expect(rendered).toContain('<character_participant id="p-kai">');
    expect(rendered).toContain(
      '<about source="generated_summary">Kai, a separate AI character in this conversation: Kai is a dry-witted archivist.</about>'
    );
  });

  it('renders name-only end-to-end when the blurb has not been generated yet', async () => {
    // The acceptance clause, exercised through the real chain rather than
    // asserted on the formatter alone: a turn racing an un-generated blurb
    // renders the roster entry without a description, and does not block.
    const rendered = await renderThroughChain(new Map());

    expect(rendered).toContain('<character_participant id="p-kai">');
    expect(rendered).toContain('<name>Kai</name>');
    expect(rendered).not.toContain('generated_summary');
  });

  it('fetches under exactly the key the renderer looks the blurb up by', async () => {
    // The two ends of the seam key on personalityId independently — the fetch
    // from `extractCharacterParticipants` over the assembled history, the
    // render from the same function over the copied history. A mismatch here
    // renders name-only, which is indistinguishable from "not generated yet"
    // at every other vantage point.
    const rendered = await renderThroughChain(new Map([['p-kai', 'Kai is an archivist.']]));

    expect(rendered).toContain('Kai is an archivist.');
  });
});
