/**
 * Log Sanitization Utility
 *
 * Redacts sensitive information (API keys, tokens) from log messages
 * to prevent accidental exposure in logs.
 *
 * Patterns covered:
 * - OpenAI: sk-... (48+ chars), sk-proj-... (project keys)
 * - Google: AIza... (39 chars)
 * - Anthropic: sk-ant-... (anthropic keys)
 * - OpenRouter: sk-or-... (openrouter keys)
 * - Generic Bearer tokens
 * - Database URLs with passwords
 */

/**
 * Sensitive patterns to redact from logs.
 * Each pattern captures the key format and replaces with [REDACTED].
 *
 * IMPORTANT: Order matters! More specific patterns must come BEFORE general ones.
 * For example, sk-ant-... must be matched before sk-... to preserve the prefix.
 */
const SENSITIVE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // More specific sk-* patterns first (before generic sk-...)
  // OpenRouter API keys: sk-or-...
  { pattern: /sk-or-[a-zA-Z0-9_-]{20,}/g, replacement: 'sk-or-[REDACTED]' },

  // Anthropic API keys: sk-ant-...
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, replacement: 'sk-ant-[REDACTED]' },

  // OpenAI API keys: sk-... (standard) or sk-proj-... (project keys)
  // This is the catch-all for sk- patterns, so it comes after specific ones
  { pattern: /sk-[a-zA-Z0-9_-]{20,}/g, replacement: 'sk-[REDACTED]' },

  // Google API keys: AIza...
  { pattern: /AIza[a-zA-Z0-9_-]{35,}/g, replacement: 'AIza[REDACTED]' },

  // Bearer tokens in headers (preserve "Bearer" prefix)
  { pattern: /(Bearer\s+)[a-zA-Z0-9_.-]+/gi, replacement: '$1[REDACTED]' },

  // Database URLs with passwords (postgresql://user:password@host)
  {
    pattern: /(postgresql|postgres|mysql|redis):\/\/[^:]+:[^@]+@/gi,
    replacement: '$1://[REDACTED]@',
  },

  // Generic API key patterns in JSON/objects
  {
    pattern: /"(api[_-]?key|apikey|secret|token|password)":\s*"[^"]+"/gi,
    replacement: '"$1": "[REDACTED]"',
  },
];

/**
 * Sanitizes a string by replacing sensitive patterns with redaction markers.
 *
 * @param message - The string to sanitize
 * @returns The sanitized string with sensitive data redacted
 */
export function sanitizeLogMessage(message: string): string {
  if (typeof message !== 'string') {
    return message;
  }

  let sanitized = message;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global patterns (they maintain state)
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/**
 * Recursively sanitizes an object, redacting sensitive values in strings.
 *
 * @param obj - The object to sanitize
 * @param depth - Current recursion depth (prevents infinite loops)
 * @returns The sanitized object
 */
export function sanitizeObject(obj: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return '[MAX_DEPTH_EXCEEDED]';
  }

  // Handle null/undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle strings
  if (typeof obj === 'string') {
    return sanitizeLogMessage(obj);
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }

  // Handle objects
  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Check if the key itself suggests sensitive data
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('apikey') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('password') ||
        lowerKey.includes('authorization')
      ) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeObject(value, depth + 1);
      }
    }
    return sanitized;
  }

  // Return primitives as-is
  return obj;
}

/**
 * Creates Pino serializers that sanitize sensitive data.
 * Use with createLogger() to add automatic sanitization.
 */
export function createSanitizedSerializers(): Record<string, (obj: unknown) => unknown> {
  return {
    req: (req: unknown) => sanitizeObject(req),
    res: (res: unknown) => sanitizeObject(res),
  };
}

/**
 * Pino hook to sanitize log bindings (the first object argument in log calls).
 * This ensures all logged objects have sensitive data redacted.
 *
 * Usage:
 * ```typescript
 * const logger = pino({
 *   hooks: {
 *     logMethod: sanitizeLogHook
 *   }
 * });
 * ```
 */
export function sanitizeLogHook(
  this: unknown,
  args: Parameters<typeof Function.prototype.apply>,
  method: (...args: unknown[]) => void
): void {
  // args[0] is the first argument to the log method
  // It could be an object (bindings) or a string (message)
  if (args.length > 0) {
    if (typeof args[0] === 'object' && args[0] !== null) {
      args[0] = sanitizeObject(args[0]);
    } else if (typeof args[0] === 'string') {
      args[0] = sanitizeLogMessage(args[0]);
    }

    // Also sanitize any additional string arguments (the message)
    for (let i = 1; i < args.length; i++) {
      if (typeof args[i] === 'string') {
        args[i] = sanitizeLogMessage(args[i] as string);
      }
    }
  }

  method.apply(this, args);
}
