/**
 * Guarded chat-model invocation.
 *
 * `BaseChatModel.invoke` is implemented as
 * `(await this.generatePrompt(...)).generations[0][0].message` — an unguarded
 * double index. A provider that answers HTTP 200 with zero choices produces an
 * empty `generations` array (@langchain/openai builds generations from
 * `data?.choices ?? []`), so `invoke` throws
 * `TypeError: Cannot read properties of undefined (reading 'message')` from
 * inside LangChain. That TypeError then classifies by its own crash text
 * (SDK_PARSING -> SERVER_ERROR) rather than by what actually happened.
 *
 * This helper makes the same call through `generate` — which `invoke` itself
 * delegates to via `generatePrompt` — and checks the generation exists before
 * reading `.message`, so a zero-choices response becomes a classified
 * `EMPTY_RESPONSE` failure. Pinned by `invokeModelGuarded.test.ts`.
 */

import {
  type BaseChatModel,
  type BaseChatModelCallOptions,
} from '@langchain/core/language_models/chat_models';
import { type AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { type ChatGeneration } from '@langchain/core/outputs';
import { ERROR_MESSAGES } from '@tzurot/common-types/constants/error';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('InvokeModelGuarded');

/**
 * Invoke a chat model, converting a zero-choices success response into a
 * classified empty-response failure instead of a LangChain-internal TypeError.
 *
 * Argument and return shapes match `BaseChatModel.invoke` for the message-array
 * input form, so this is a drop-in replacement at every call site.
 *
 * @throws Error with `ERROR_MESSAGES.EMPTY_RESPONSE` when the provider returned
 *   no generations.
 */
export async function invokeModelGuarded(
  model: BaseChatModel,
  messages: BaseMessage[],
  options?: Partial<BaseChatModelCallOptions>
): Promise<AIMessageChunk> {
  const result = await model.generate([messages], options, options?.callbacks);
  // LLMResult types `generations` as always-present, but this guard exists
  // precisely because providers ship shapes the typings promise away — treat
  // the outer array as untrusted too, not just the inner index.
  const generations = result.generations as ChatGeneration[][] | undefined;
  const generation = generations?.[0]?.[0];

  if (generation === undefined) {
    logger.warn(
      { promptCount: generations?.length ?? 0 },
      'Model returned zero choices for the prompt — treating as an empty response'
    );
    throw new Error(ERROR_MESSAGES.EMPTY_RESPONSE);
  }

  // `BaseChatModel.invoke` declares this same `.message` as its
  // `OutputMessageType` (AIMessageChunk by default) while `LLMResult` types
  // generations as the narrower `Generation`. Mirroring core's own declaration
  // keeps every call site's response type identical to what `invoke` returned.
  return generation.message as AIMessageChunk;
}
