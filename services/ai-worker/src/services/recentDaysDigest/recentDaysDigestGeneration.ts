/**
 * Recent-days digest generation: one pair's window load, the model round
 * (first pass, at most one regeneration), and the validated outcome. This
 * module performs NO writes other than the usage row billed per model call —
 * the digest-row success/failure writes belong to the sweep, which reads the
 * outcome this module returns and dispatches accordingly.
 */

import {
  RECENT_DAYS_DIGEST,
  RECENT_DAYS_DIGEST_PROMPT_VERSION,
  type DigestFailureClass,
} from '@tzurot/common-types/constants/recentDaysDigest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { DigestCandidatePair } from '@tzurot/common-types/services/recentDaysDigestSelection';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { extractJsonPayload } from '../extraction/extractionPrompt.js';
import type { SystemModelInvoker } from '../systemModel/systemModelCall.js';
import {
  buildDigestInput,
  type DigestInputWindow,
  type DigestSourceRow,
} from './recentDaysDigestInput.js';
import {
  buildDigestPrompt,
  buildRegenerateDigestPrompt,
  buildDigestRegenerationFeedback,
  digestResponseSchema,
  type DigestPromptInput,
} from './recentDaysDigestPrompt.js';
import {
  decideDigestLength,
  validateDigest,
  type DigestLengthState,
  type DigestValidationResult,
} from './recentDaysDigestValidation.js';
import { writeRecentDaysDigestUsageLog } from './recentDaysDigestUsageLog.js';

export interface RawSourceRow {
  id: string;
  role: string;
  content: string;
  created_at: Date;
  channel_id: string;
  guild_id: string | null;
}

/** Load one pair's window, newest-first, capped at `MAX_SOURCE_MESSAGES + 1`
 *  — the `+1` is how `buildDigestInput` detects truncation without a
 *  separate count query. */
export async function loadWindowRows(
  prisma: PrismaClient,
  pair: DigestCandidatePair,
  now: Date
): Promise<DigestSourceRow[]> {
  const windowFloor = new Date(now.getTime() - RECENT_DAYS_DIGEST.WINDOW_DAYS * 86_400_000);
  const floor = pair.epoch !== null && pair.epoch > windowFloor ? pair.epoch : windowFloor;
  const rows = await prisma.$queryRaw<RawSourceRow[]>`
    SELECT id, role, content, created_at, channel_id, guild_id
    FROM conversation_history
    WHERE persona_id = ${pair.personaId}::uuid AND personality_id = ${pair.personalityId}::uuid
      AND deleted_at IS NULL AND created_at >= ${floor}::timestamptz
    ORDER BY created_at DESC
    LIMIT ${RECENT_DAYS_DIGEST.MAX_SOURCE_MESSAGES + 1}
  `;
  return rows.map(row => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    channelId: row.channel_id,
    guildId: row.guild_id,
  }));
}

/** The per-pair prompt context: the built input window, the prompt input the
 *  model actually receives, and the assistant-only contents the validator
 *  checks against. */
export interface PairGenerationContext {
  windowInput: DigestInputWindow;
  promptInput: DigestPromptInput;
  assistantContents: string[];
}

/** Both the sweep and the dry run build their prompt input through this
 *  function, so the dry run cannot drift from what the sweep sends. */
export function buildPairGenerationContext(
  pair: DigestCandidatePair,
  rows: DigestSourceRow[]
): PairGenerationContext {
  const names = {
    personaLabel: pair.personaPreferredName ?? pair.personaName,
    characterLabel: pair.personalityDisplayName ?? pair.personalityName,
  };
  const windowInput = buildDigestInput({ rows, tz: pair.ownerTimezone, names });
  const promptInput: DigestPromptInput = {
    personaLabel: names.personaLabel,
    characterLabel: names.characterLabel,
    lines: windowInput.lines,
    truncated: windowInput.truncated,
    windowStart: windowInput.windowStart,
    tz: pair.ownerTimezone,
  };
  const assistantContents = rows
    .filter(row => row.role === (MessageRole.Assistant as string))
    .map(row => row.content);
  return { windowInput, promptInput, assistantContents };
}

interface CallOutcome {
  digest: string | null;
  model: string;
  raw: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

/** One model call + usage row + JSON parse. `digest` is null on a parse
 *  failure — a parse failure is terminal on whichever pass produced it,
 *  mirroring the memory-archive summarizer (no regeneration is attempted FOR
 *  a parse failure itself) — but the raw response text is always returned so
 *  a parse failure still has something to show (pinned by
 *  recentDaysDigestGeneration.test.ts, 'a first-pass parse failure is
 *  terminal, raw text preserved, no regeneration'). `writeUsage: false` (the dry
 *  run) still bills the model call but skips the usage_logs write. */
async function callAndParse(
  prisma: PrismaClient,
  invoke: SystemModelInvoker,
  prompt: string,
  pair: DigestCandidatePair,
  writeUsage = true
): Promise<CallOutcome> {
  const start = Date.now();
  const usage = await invoke(prompt);
  const latencyMs = Date.now() - start;
  if (writeUsage) {
    await writeRecentDaysDigestUsageLog(
      prisma,
      usage,
      { personalityId: pair.personalityId, ownerId: pair.ownerId },
      latencyMs
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(extractJsonPayload(usage.content));
  } catch {
    payload = undefined;
  }
  const parsed = payload === undefined ? undefined : digestResponseSchema.safeParse(payload);
  return {
    digest: parsed?.success === true ? parsed.data.digest : null,
    model: usage.model,
    raw: usage.content,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs,
  };
}

/** One model pass's raw output plus its validation/length verdicts (both
 *  null when the pass failed to parse). */
export interface PassReport {
  /** The model's raw response text, exactly as returned. */
  raw: string;
  /** The parsed digest text, or null when the response did not parse. */
  parsed: string | null;
  validation: DigestValidationResult | null;
  lengthState: DigestLengthState | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

function toPassReport(outcome: CallOutcome): PassReport {
  return {
    raw: outcome.raw,
    parsed: outcome.digest,
    validation: null,
    lengthState: null,
    tokensIn: outcome.tokensIn,
    tokensOut: outcome.tokensOut,
    latencyMs: outcome.latencyMs,
  };
}

export type DigestGenerationOutcome =
  | {
      kind: 'success';
      text: string;
      model: string;
      promptVersion: number;
      firstPass: PassReport;
      regen?: PassReport;
    }
  | {
      kind: 'failed';
      cls: DigestFailureClass;
      detail: string;
      firstPass: PassReport;
      regen?: PassReport;
    }
  | { kind: 'parse_failure'; firstPass: PassReport; regen?: PassReport };

/** The model round for one pair: first pass, at most one regeneration, then
 *  the validated outcome. Performs no writes other than the usage row. */
export async function runGeneration(ctx: {
  prisma: PrismaClient;
  pair: DigestCandidatePair;
  invoke: SystemModelInvoker;
  promptInput: DigestPromptInput;
  assistantContents: string[];
  /** False for the dry run: the model call is still billed, no usage row is written. */
  writeUsage?: boolean;
}): Promise<DigestGenerationOutcome> {
  const { prisma, pair, invoke, promptInput, assistantContents, writeUsage = true } = ctx;

  const firstOutcome = await callAndParse(
    prisma,
    invoke,
    buildDigestPrompt(promptInput),
    pair,
    writeUsage
  );
  const firstPass = toPassReport(firstOutcome);
  if (firstOutcome.digest === null) {
    return { kind: 'parse_failure', firstPass };
  }

  const firstValidation = validateDigest(firstOutcome.digest, assistantContents);
  const firstLength = decideDigestLength(countTextTokens(firstOutcome.digest));
  firstPass.validation = firstValidation;
  firstPass.lengthState = firstLength;
  const needsRegen = !firstValidation.ok || firstLength === 'over_soft';

  let regen: PassReport | undefined;
  let finalText = firstOutcome.digest;
  let finalModel = firstOutcome.model;
  let finalValidation = firstValidation;

  if (needsRegen) {
    const regenOutcome = await callAndParse(
      prisma,
      invoke,
      buildRegenerateDigestPrompt(
        promptInput,
        firstOutcome.digest,
        buildDigestRegenerationFeedback({
          overLength: firstLength !== 'within_soft',
          firstPerson: !firstValidation.ok && firstValidation.cls === 'first_person',
          quoted:
            !firstValidation.ok && firstValidation.cls === 'quotation'
              ? firstValidation.detail
              : null,
        })
      ),
      pair,
      writeUsage
    );
    regen = toPassReport(regenOutcome);
    if (regenOutcome.digest === null) {
      return { kind: 'parse_failure', firstPass, regen };
    }
    finalText = regenOutcome.digest;
    finalModel = regenOutcome.model;
    finalValidation = validateDigest(finalText, assistantContents);
    regen.validation = finalValidation;
    regen.lengthState = decideDigestLength(countTextTokens(finalText));
  }

  if (!finalValidation.ok) {
    return {
      kind: 'failed',
      cls: finalValidation.cls,
      detail: finalValidation.detail,
      firstPass,
      ...(regen !== undefined && { regen }),
    };
  }

  return {
    kind: 'success',
    text: finalText,
    model: finalModel,
    promptVersion: RECENT_DAYS_DIGEST_PROMPT_VERSION,
    firstPass,
    ...(regen !== undefined && { regen }),
  };
}
