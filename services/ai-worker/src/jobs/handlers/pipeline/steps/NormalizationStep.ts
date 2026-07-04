/**
 * Normalization Step
 *
 * Normalizes job data types after validation passes, ensuring consistent types
 * for downstream steps.
 *
 * Normalizes referenced-message timestamps: Date objects (from Discord.js) → ISO
 * strings (after BullMQ serialization).
 *
 * Runs after ValidationStep to ensure the data structure is valid before normalization.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { normalizeTimestamp } from '@tzurot/common-types/utils/messageNormalization';
import type { IPipelineStep, GenerationContext } from '../types.js';

const logger = createLogger('NormalizationStep');

export class NormalizationStep implements IPipelineStep {
  readonly name = 'Normalization';

  process(context: GenerationContext): GenerationContext {
    const { job } = context;
    const { referencedMessages } = job.data.context;

    const timestampNormalizations = this.normalizeReferencedMessages(referencedMessages);

    // Log if any normalizations occurred (helps track legacy data)
    if (timestampNormalizations > 0) {
      logger.info({ jobId: job.id, timestampNormalizations }, 'Normalized legacy data formats');
    } else {
      logger.debug({ jobId: job.id }, 'No normalization needed');
    }

    return context;
  }

  /**
   * Normalize referenced message timestamps in place. Returns the count normalized.
   */
  private normalizeReferencedMessages(
    referencedMessages: GenerationContext['job']['data']['context']['referencedMessages']
  ): number {
    if (!referencedMessages || referencedMessages.length === 0) {
      return 0;
    }

    let timestampNormalizations = 0;
    for (const ref of referencedMessages) {
      if (ref.timestamp !== undefined) {
        const normalizedTimestamp = normalizeTimestamp(ref.timestamp);
        if (normalizedTimestamp !== undefined && ref.timestamp !== normalizedTimestamp) {
          ref.timestamp = normalizedTimestamp;
          timestampNormalizations++;
        }
      }
    }

    return timestampNormalizations;
  }
}
