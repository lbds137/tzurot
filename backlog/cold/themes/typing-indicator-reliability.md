### Theme: Typing Indicator Reliability

_Focus: diagnose and fix intermittent typing-indicator dropouts during long AI responses. The error-differentiation classifier (`typingErrorClassifier.ts`) has SHIPPED — what remains is the log-driven investigation below plus the two sub-items (route the `VoiceTranscriptionService` initial send through the classifier; respect `retryAfterSeconds` in the backoff)._

**Observed**: user has seen the "bot is typing…" indicator disappearing before the AI response actually lands, multiple times, not yet reproduced deterministically. Unclear whether this is a bot-side bug (failed `sendTyping` refresh not recovering) or a Discord client-side display glitch.

**Current implementation — two independent typing loops**:

- `services/bot-client/src/services/JobTracker.ts:85-149` — fires `channel.sendTyping()` every 8s until the 10-min cutoff or job completion. Errors swallowed at lines 144-146.
- `services/bot-client/src/services/VoiceTranscriptionService.ts:186-198` — independent interval at the same cadence for voice flows, also swallowing errors.

**Hypotheses (ranked by likelihood)**:

1. **Rate limiting on `sendTyping`** — Discord rate-limits `POST /channels/{id}/typing` per-channel. Concurrent @mentions in the same channel can double the effective rate. Current catch treats 429s identically to other errors — no backoff. **Check after step 1 (Quick Win) ships**: log-search for 429 classifications grouped by channel and 5-min windows.
2. **Handoff gap between VoiceTranscriptionService and JobTracker** — for voice flows, VoiceTranscription's interval terminates when transcription finishes; JobTracker starts after. If the gap is >2s, the Discord indicator flickers off (Discord typing TTL is ~10s; we refresh at 8s, only 2s buffer). **Check**: instrument the transition with a timestamped log pair.
3. **Gateway disconnect/reconnect during long jobs** — `typingInterval` keeps firing in-process but REST calls may fail silently or queue. Correlate typing dropouts with `Client#disconnect`/`Client#resume` events.
4. **Discord client-side rendering bug** — anecdotal, known to happen on mobile / intermittent connections. Not fixable bot-side; only relevant to rule out.
5. **Abuse-prevention heuristics** — anecdotal reports of Discord suppressing typing indicators that have been running continuously "for a long time." No official documentation. Check: does dropout correlate with job age?
6. **discord.js bug/regression** — check v14.26.2 release notes for typing-related changes.

**Investigation steps (after Quick Win step 1 ships)**:

2. **Per-channel aggregation telemetry** — count of `sendTyping` calls and failures per channel per 5-min window. Surfaces rate-limit patterns.
3. **Voice-handoff gap measurement** — instrument the VoiceTranscriptionService → JobTracker transition. If gap >2s on reproducer cases, this is the voice-specific failure mode.
4. **User-side repro capture** — when user notices next dropout, record channel / time (UTC) / voice-or-text / long-or-short reply / client (desktop/web/mobile). Cross-reference with differentiated logs.

**Remediation options (pick after findings)**:

- **If rate-limiting**: coalesce typing loops per-channel (one loop per channel regardless of concurrent jobs), or back off on 429 instead of retrying at fixed cadence. Reducing refresh 8s → 7s widens buffer but also increases rate.
- **If voice-handoff gap**: continue the first typing loop across the handoff rather than restarting fresh.
- **If gateway reconnect**: subscribe to `Client#resume` and re-fire typing for all tracked jobs on reconnect.
- **If Discord client bug**: document and close.

**Why this matters despite being "small" UX**: the typing indicator is the sole signal a user has that the bot received their message. Dropouts → users assume "bot is broken" → they retry → duplicate requests → more load → more rate limits → more dropouts. The loop gets worse under load, not self-healing.

**Start**: Quick Win "Differentiate typing-indicator error types" ships first. That entry is the prerequisite — its differentiated logs drive every step here. Surfaced 2026-04-22.

#### Sub-item: Route `VoiceTranscriptionService` initial `sendTyping` through the classifier

Surfaced 2026-04-24 by PR #886 review. `JobTracker` wraps both the interval-loop and the initial-send `channel.sendTyping()` in `handleTypingError`. `VoiceTranscriptionService.transcribe` routes only the interval-loop; the initial `await channel.sendTyping()` at line 188 propagates a channel-unreachable error up to the outer `try/catch`, which fails the whole transcription with a generic catch-all reply instead of the classifier's differentiated "channel unreachable" log + graceful return. Fix: wrap the initial send in try/catch or route through `handleTypingError` like JobTracker does, and decide whether channel-unreachable should abort transcription or proceed without the typing indicator. **Start**: `services/bot-client/src/services/VoiceTranscriptionService.ts:188`.

#### Sub-item: Respect `retryAfterSeconds` in the typing-indicator backoff

Surfaced 2026-04-24 by PR #886 review. When Discord rate-limits `sendTyping` with a 429, the classifier warns and returns but the interval keeps firing at its normal 8s cadence. If `retryAfterSeconds > TYPING_INDICATOR_INTERVAL_MS / 1000` (1.5s at current settings but the typing refresh is 8s — meaning retryAfter > 8s in practice), every subsequent tick inside the backoff window also gets rate-limited, generating a warn log every 8s until the window clears. Under sustained rate-limiting this produces a noisy burst of warn entries in Railway logs and wastes API calls we know will fail. **Fix shape**: when `handleTypingError` returns `rate-limit` with a `retryAfterSeconds`, pause the interval for at least that duration — either `clearInterval` + `setTimeout` to re-arm, or track a `pausedUntil: number` timestamp in the tracker and have each interval tick check it before calling sendTyping. **Not urgent**: current classifier is already a substantial improvement; the noisy-log case requires a real sustained-429 event to surface.
