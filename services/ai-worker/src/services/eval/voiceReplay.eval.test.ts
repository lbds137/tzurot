/**
 * Voice-consistency REPLAY runner (stage 1 of 3) — probes → frozen input
 * bundles → arm prompts → REAL model generations → responses.json.
 *
 * This is a MEASUREMENT, not CI (memory-architecture §3.9): it spends real
 * money against real providers and runs manually via `pnpm eval:voice-replay`.
 * Inputs: reports/voice-consistency/probes.json (pnpm ops prompt:mine-voice-probes,
 * OWNER-ONLY conversations by construction) + EVAL_MEMORY_DATABASE_URL (the
 * prod-synced dev DB: personalities, persona texts, memories, facts).
 *
 * Per probe, ONE frozen bundle (history serialized once, one retrieval pass,
 * the clock pinned to the probe instant) renders through every requested arm —
 * only arrangement differs (the cross-arm invariance CI test pins this).
 *
 * Knobs: VOICE_EVAL_ARMS=A,B,B2[,C] · VOICE_EVAL_DRY_RUN=1 (token/cost
 * projection, zero model calls) · VOICE_EVAL_TZ (context timezone, default
 * UTC) · VOICE_EVAL_MAX_TOKENS (per-generation cap, default 1024).
 *
 * Disclosed approximations (identical across arms, so the PAIRED comparison
 * is unaffected): no contextual_references reconstruction; no guild
 * environment block; fixed 30k-token history budget instead of the dynamic
 * prod budget; one retrieval pass with a simple 3-turn fold.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient as PrismaClientClass,
  type PrismaClient,
} from '@tzurot/common-types/services/prisma';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { PersonalityService } from '@tzurot/identity';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { PgvectorMemoryAdapter } from '../PgvectorMemoryAdapter.js';
import { FactStore } from '../extraction/FactStore.js';
import { FactRetriever } from '../FactRetriever.js';
import { PromptBuilder } from '../PromptBuilder.js';
import { ContextWindowManager } from '../context/ContextWindowManager.js';
import { createChatModel } from '../ModelFactory.js';
import { validateAIProvider } from '../../utils/providerValidation.js';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';
import type { ConversationContext, ParticipantInfo } from '../ConversationalRAGTypes.js';
import { buildArmMessages, type ArmId, type ProbeInputs } from './voiceArms.js';
import { buildPersonaCard } from './voiceJudgePrompt.js';

const WORK_DIR = 'reports/voice-consistency';
const PROBES_PATH = join(WORK_DIR, 'probes.json');
const DB_URL = process.env.EVAL_MEMORY_DATABASE_URL;
const DRY_RUN = process.env.VOICE_EVAL_DRY_RUN === '1';
const TZ = process.env.VOICE_EVAL_TZ ?? 'UTC';
const MAX_TOKENS = Number(process.env.VOICE_EVAL_MAX_TOKENS ?? 1024);
const ARMS = (process.env.VOICE_EVAL_ARMS ?? 'A,B,B2')
  .split(',')
  .map(arm => arm.trim())
  .filter((arm): arm is ArmId => ['A', 'B', 'B2', 'C'].includes(arm));
const HISTORY_BUDGET_TOKENS = 30_000;
const MEMORY_LIMIT = 10;
/** The recent-turn fold for the retrieval query (mirrors LTM_SEARCH_HISTORY_TURNS). */
const FOLD_TURNS = 3;
/** Recent turns shipped to the judge as the register anchor. */
const JUDGE_ANCHOR_TURNS = 6;

interface ProbeHistoryEntry {
  id: string;
  discordMessageId: string[];
  role: string;
  content: string;
  createdAt: string;
  personaId: string;
  personaName: string;
  personalityId: string;
  personalityName: string;
  tokenCount: number | null;
  messageMetadata: unknown;
}

interface VoiceProbe {
  probeId: string;
  depth: number;
  channelId: string;
  guildId: string | null;
  personality: { id: string; slug: string; name: string; protocolFormat: string };
  trigger: ProbeHistoryEntry;
  priorHistory: ProbeHistoryEntry[];
  referenceReply: { id: string; content: string; createdAt: string };
}

interface GeneratedResponse {
  probeId: string;
  arm: ArmId;
  personalitySlug: string;
  depth: number;
  text: string;
  promptTokensEstimate: number;
}

/** Judge context bundled here so the judge stage needs NO DB access. */
interface ProbeJudgeContext {
  personalitySlug: string;
  depth: number;
  personaCard: string;
  recentTurns: { speaker: string; text: string }[];
  triggerText: string;
  referenceReply: string;
}

const ready = DB_URL !== undefined && DB_URL.length > 0 && existsSync(PROBES_PATH);

describe.skipIf(!ready)('voice-consistency replay (REAL model spend)', () => {
  let prisma: PrismaClient;
  let personalityService: PersonalityService;
  let adapter: PgvectorMemoryAdapter;
  let factRetriever: FactRetriever;
  const builder = new PromptBuilder();
  const windowManager = new ContextWindowManager();
  const probes: VoiceProbe[] = [];
  const personalities = new Map<string, LoadedPersonality>();
  const personaAbout = new Map<string, string>();
  const responses: GeneratedResponse[] = [];
  const judgeContext: Record<string, ProbeJudgeContext> = {};
  let projectedInputTokens = 0;

  beforeAll(async () => {
    const file = JSON.parse(readFileSync(PROBES_PATH, 'utf8')) as { probes: VoiceProbe[] };
    probes.push(...file.probes);

    prisma = new PrismaClientClass({
      adapter: new PrismaPg({ connectionString: DB_URL }),
    }) as PrismaClient;
    personalityService = new PersonalityService(prisma);
    const embeddings = new LocalEmbeddingService();
    const initialized = await embeddings.initialize();
    if (!initialized) {
      throw new Error('Local embedding model failed to initialize — retrieval cannot run');
    }
    adapter = new PgvectorMemoryAdapter(prisma, embeddings);
    factRetriever = new FactRetriever(new FactStore(prisma, embeddings));

    // Real personalities — the multi-KB identity/protocol text IS the signal.
    for (const probe of probes) {
      if (!personalities.has(probe.personality.id)) {
        const loaded = await personalityService.loadPersonality(probe.personality.id);
        if (loaded === null) {
          throw new Error(`Personality ${probe.personality.slug} not loadable from the eval DB`);
        }
        personalities.set(probe.personality.id, loaded);
      }
      if (!personaAbout.has(probe.trigger.personaId)) {
        const rows = await prisma.$queryRaw<{ content: string }[]>`
          SELECT content FROM personas WHERE id = ${probe.trigger.personaId}::uuid
        `;
        personaAbout.set(probe.trigger.personaId, rows[0]?.content ?? '');
      }
    }
  }, 900_000);

  afterAll(async () => {
    if (DRY_RUN) {
      console.log(
        `\n=== DRY RUN: ${probes.length} probes × arms [${ARMS.join(',')}] ≈ ` +
          `${projectedInputTokens.toLocaleString()} input tokens, 0 model calls made ===`
      );
    } else if (responses.length > 0) {
      mkdirSync(WORK_DIR, { recursive: true });
      writeFileSync(
        join(WORK_DIR, 'responses.json'),
        `${JSON.stringify({ meta: { arms: ARMS, generatedAt: new Date().toISOString() }, judgeContext, responses }, null, 2)}\n`
      );
      console.log(
        `\n=== voice replay: ${responses.length} generations → ${WORK_DIR}/responses.json ===`
      );
    }
    await prisma.$disconnect();
  }, 120_000);

  /** Freeze one probe's input bundle (clock pinned to the probe instant). */
  async function buildProbeInputs(probe: VoiceProbe): Promise<ProbeInputs> {
    const personality = personalities.get(probe.personality.id);
    if (personality === undefined) {
      throw new Error(`Personality missing for probe ${probe.probeId}`);
    }
    const rawHistory: StructuredHistoryEntry[] = probe.priorHistory.map(entry => ({
      id: entry.id,
      discordMessageId: entry.discordMessageId,
      role: entry.role,
      content: entry.content,
      createdAt: entry.createdAt,
      personaId: entry.personaId,
      personaName: entry.personaName,
      tokenCount: entry.tokenCount ?? undefined,
      messageMetadata: (entry.messageMetadata ??
        undefined) as StructuredHistoryEntry['messageMetadata'],
      personalityId: entry.personalityId,
      personalityName: entry.personalityName,
    }));

    const context: ConversationContext = {
      userId: 'voice-eval',
      channelId: probe.channelId,
      activePersonaName: probe.trigger.personaName,
      activePersonaId: probe.trigger.personaId,
      userTimezone: TZ,
    };
    const participantPersonas = new Map<string, ParticipantInfo>([
      [
        probe.trigger.personaId,
        {
          personaName: probe.trigger.personaName,
          content: personaAbout.get(probe.trigger.personaId) ?? '',
          isActive: true,
          personaId: probe.trigger.personaId,
        },
      ],
    ]);

    // One retrieval pass, shared by every arm (the paired-design guarantee).
    const fold = probe.priorHistory
      .slice(-FOLD_TURNS)
      .map(entry => entry.content)
      .join('\n');
    const searchQuery = builder.buildSearchQuery(probe.trigger.content, [], undefined, fold);
    const relevantMemories = await adapter.queryMemories(searchQuery, {
      personaId: probe.trigger.personaId,
      personalityId: probe.personality.id,
      limit: MEMORY_LIMIT,
    });
    const facts = await factRetriever.retrieveFacts(
      searchQuery,
      probe.personality.id,
      probe.trigger.personaId
    );

    // Serialize history ONCE under the probe-instant clock (identical bytes to
    // every arm; the datetime section reads the same pinned clock).
    const { serializedHistory } = windowManager.selectAndSerializeHistory(
      rawHistory,
      // Id included so the replay serializes history the way production now
      // does; without it the harness would exercise the name-only fallback
      // that production only reaches for id-less rows.
      { name: personality.name, id: personality.id },
      HISTORY_BUDGET_TOKENS,
      { headerIdTags: new Map() }
    );

    return {
      personality,
      context,
      participantPersonas,
      serializedHistory,
      relevantMemories,
      facts: facts.map(fact => ({ statement: fact.statement })),
      referencedMessagesFormatted: undefined,
      userMessage: probe.trigger.content,
    };
  }

  it(
    'generates paired responses for every probe under every requested arm',
    { timeout: 3_600_000 },
    async () => {
      expect(probes.length).toBeGreaterThan(0);
      for (const probe of probes) {
        // Retrieval + history serialization run under REAL timers (DB/embedding
        // awaits can hang on internal setTimeouts under fake ones; chat-log
        // timestamps are absolute-only, so they don't read the clock).
        const inputs = await buildProbeInputs(probe);

        // Pin the clock ONLY for the synchronous arm builds — both assemblies
        // read new Date() for the <context> datetime and the memory-timestamp
        // relative suffixes, which must reflect the probe instant.
        const armMessages = new Map<ArmId, { system: string; human: string }>();
        vi.useFakeTimers();
        vi.setSystemTime(new Date(probe.trigger.createdAt));
        try {
          for (const arm of ARMS) {
            armMessages.set(arm, buildArmMessages(arm, inputs));
          }
        } finally {
          vi.useRealTimers();
        }

        judgeContext[probe.probeId] = {
          personalitySlug: probe.personality.slug,
          depth: probe.depth,
          personaCard: buildPersonaCard(inputs.personality),
          recentTurns: probe.priorHistory.slice(-JUDGE_ANCHOR_TURNS).map(entry => ({
            speaker: entry.role === 'user' ? entry.personaName : entry.personalityName,
            text: entry.content,
          })),
          triggerText: probe.trigger.content,
          referenceReply: probe.referenceReply.content,
        };

        for (const [arm, messages] of armMessages) {
          const promptTokensEstimate =
            builder.countTokens(messages.system) + builder.countTokens(messages.human);
          projectedInputTokens += promptTokensEstimate;
          if (DRY_RUN) {
            continue;
          }
          const personality = inputs.personality;
          const { model } = createChatModel({
            provider: validateAIProvider(personality.provider),
            modelName: personality.model,
            temperature: personality.temperature,
            topP: personality.topP,
            maxTokens: Math.min(personality.maxTokens ?? MAX_TOKENS, MAX_TOKENS),
            appTitleSuffix: 'VoiceEval',
            apiKey:
              personality.provider === 'zai-coding' ? process.env.ZAI_CODING_API_KEY : undefined,
          });
          const result = await model.invoke([
            new SystemMessage(messages.system),
            new HumanMessage(messages.human),
          ]);
          const text =
            typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
          responses.push({
            probeId: probe.probeId,
            arm,
            personalitySlug: probe.personality.slug,
            depth: probe.depth,
            text,
            promptTokensEstimate,
          });
          console.log(
            `${probe.personality.slug} d${probe.depth} arm ${arm}: ${text.length} chars ` +
              `(~${promptTokensEstimate.toLocaleString()} input tokens)`
          );
        }
      }
      if (!DRY_RUN) {
        expect(responses.length).toBe(probes.length * ARMS.length);
      }
    }
  );
});
