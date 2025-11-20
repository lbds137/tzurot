# Whisper Transcript Cleanup with LLM Post-Processing

**Status**: Proposed
**Priority**: Medium
**Estimated Effort**: Small (1-2 days)
**Last Updated**: 2025-11-08

## Problem

Whisper transcriptions of voice messages can be messy:

- Missing or incorrect punctuation
- Run-on sentences
- Filler words (um, uh, like, you know)
- Transcription errors (homophones, mishearings)
- No paragraph breaks in long messages
- Inconsistent capitalization

This makes transcribed voice messages harder to read and can confuse the LLM when processing them as part of the conversation context.

## Proposed Solution

Add an optional LLM-based cleanup pass after Whisper transcription, before adding the transcript to the message context.

### Architecture

**Where**: In `ai-worker` service, after Whisper transcription completes

**Flow**:

```
1. Download audio → AUDIO_FETCH (60s)
2. Whisper transcription → WHISPER_API (90s)
3. [NEW] LLM cleanup pass → ~30s (fast model)
4. Add cleaned transcript to context
```

**Model Selection**: Use a cheap, fast model for cleanup

- Recommended: `anthropic/claude-haiku-4.5` or `gpt-3.5-turbo`
- Temperature: 0.2-0.3 (deterministic)
- Max tokens: 2048 (transcripts shouldn't be huge)

### Configuration

**Option 1: Global toggle**

```typescript
// In config/config.ts
AUTO_CLEANUP_TRANSCRIPTS: z.enum(['true', 'false'])
  .optional()
  .transform(val => val === 'true')
  .default(false);
```

**Option 2: Personality-level setting** (more flexible)

```typescript
// In personality JSON
{
  "name": "Lilith",
  "cleanupTranscripts": true,  // Enable for this personality
  "cleanupModel": "anthropic/claude-haiku-4.5"  // Optional override
}
```

### System Prompt

```typescript
export const TRANSCRIPT_CLEANUP_PROMPT = `You are a transcription editor. Clean up this voice message transcription:

Guidelines:
- Add proper punctuation and capitalization
- Remove filler words (um, uh, like, you know, etc.)
- Fix obvious transcription errors (homophones, mishearings)
- Break into paragraphs if the message is long (>3 sentences)
- Preserve the original meaning exactly - do not add information
- Keep the speaker's natural voice and tone

Original transcript:
{transcript}

Cleaned transcript:`;
```

### Timeout Implications

Current audio processing time: 150s (60s download + 90s transcription)

With cleanup: 150s + 30s = 180s total

**Updated `calculateJobTimeout()`**:

```typescript
const audioBatchTime =
  audioCount > 0 ? TIMEOUTS.AUDIO_FETCH + TIMEOUTS.WHISPER_API + TIMEOUTS.TRANSCRIPT_CLEANUP : 0;
```

**New constant in `constants/timing.ts`**:

```typescript
export const TIMEOUTS = {
  // ... existing timeouts
  /** Transcript cleanup with fast LLM (30 seconds) */
  TRANSCRIPT_CLEANUP: 30000,
};
```

### Implementation Plan

**Phase 1: Core Functionality**

1. Add `TRANSCRIPT_CLEANUP_PROMPT` and constants
2. Create `TranscriptCleanupService` class
3. Wire into audio attachment processing flow
4. Add toggle configuration (start with global flag)

**Phase 2: Testing**

1. Unit tests for cleanup service
2. Test with various transcript quality levels
3. Verify timeout allocation works correctly
4. Manual testing with real voice messages

**Phase 3: Monitoring**

1. Add logging for cleanup pass duration
2. Track cleanup success/failure rate
3. Monitor impact on total audio processing time

### Code Structure

```typescript
// services/ai-worker/src/services/TranscriptCleanupService.ts
export class TranscriptCleanupService {
  constructor(
    private readonly llmInvoker: LLMInvoker,
    private readonly config: EnvConfig
  ) {}

  async cleanup(rawTranscript: string): Promise<string> {
    // Skip if feature disabled
    if (!this.config.AUTO_CLEANUP_TRANSCRIPTS) {
      return rawTranscript;
    }

    const prompt = TRANSCRIPT_CLEANUP_PROMPT.replace('{transcript}', rawTranscript);

    const model = this.createCleanupModel();
    const response = await this.llmInvoker.invokeWithRetry(
      model,
      [new HumanMessage(prompt)],
      TRANSCRIPT_CLEANUP_MODEL,
      0, // no image attachments
      0 // no audio attachments
    );

    return response.content.toString().trim();
  }

  private createCleanupModel(): BaseChatModel {
    // Use cheap, fast model with low temperature
    return new ChatOpenRouter({
      modelName: TRANSCRIPT_CLEANUP_MODEL,
      temperature: TRANSCRIPT_CLEANUP_TEMPERATURE,
      maxTokens: 2048,
    });
  }
}
```

### Edge Cases to Consider

1. **Cleanup makes transcript worse**: Fall back to original if cleanup fails
2. **Timeout during cleanup**: Treat as non-critical, use original transcript
3. **Very long transcripts**: Consider chunking if > 2000 words
4. **Multiple languages**: Whisper language detection → pass to cleanup prompt
5. **User preference**: Some users might want raw transcripts

### Alternatives Considered

**Alternative 1: Regex-based cleanup**

- Pros: Instant, no API cost
- Cons: Limited effectiveness, can't fix transcription errors

**Alternative 2: Fine-tuned model**

- Pros: Could be more specialized
- Cons: Training/maintenance overhead, not worth it for this use case

**Alternative 3: Always-on (no toggle)**

- Pros: Simpler implementation
- Cons: Adds 30s to every audio message, users can't opt out

## Benefits

- **Better readability**: Cleaned transcripts are easier for humans and LLMs to parse
- **Improved context**: LLM gets cleaner input, potentially better responses
- **Professional appearance**: Voice messages look more polished in logs/UI
- **Configurable**: Users can enable/disable per preference

## Risks & Mitigations

| Risk                         | Mitigation                                            |
| ---------------------------- | ----------------------------------------------------- |
| Cleanup changes meaning      | Conservative prompt, fall back to original on failure |
| Adds 30s to audio processing | Make it optional, monitor timeout rates               |
| API cost increase            | Use cheapest model (Haiku ~$0.001 per message)        |
| Cleanup fails                | Non-critical error, use original transcript           |

## Success Metrics

After implementing, track:

- Cleanup success rate (should be >95%)
- Average cleanup duration (should be <30s)
- Timeout rate for audio messages (should not increase significantly)
- User feedback on transcript quality (if collecting)

## Related Work

- PR #225: Timeout optimization (sets foundation for adding cleanup pass)
- Audio attachment processing in `ai-worker/src/services/AttachmentProcessor.ts`
- Whisper integration in `ai-worker/src/services/WhisperService.ts`

## Future Enhancements

- **Summarization**: For very long voice messages, offer summary instead of full transcript
- **Speaker diarization**: Clean up multi-speaker transcripts with speaker labels
- **Custom cleanup profiles**: Per-personality cleanup styles (formal vs casual)
- **A/B testing**: Compare response quality with/without cleanup
