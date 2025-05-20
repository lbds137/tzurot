# Managing Problematic Personalities

Some personalities may consistently encounter API issues that cause errors in their responses. This document explains how to handle them.

## Background

Occasionally, specific personalities may return error content rather than proper responses due to various API or model issues. When this happens, these errors would normally be shown to users, which provides a poor experience.

To address this, Tzurot includes a mechanism to gracefully handle these problematic personalities by:
1. Recognizing when a personality consistently returns errors
2. Providing generic, personality-appropriate fallback responses instead of error messages
3. Adding the personality to a temporary blackout period to prevent duplicate error messages

## Configuration

You can pre-configure known problematic personalities through the `.env` file:

```
# Comma-separated list of personality IDs that require special error handling
KNOWN_PROBLEMATIC_PERSONALITIES=personality-a,personality-b,personality-c
```

For example:
```
KNOWN_PROBLEMATIC_PERSONALITIES=lucifer-kochav-shenafal,lilith-tzel-shani
```

When a personality is listed in this environment variable:
- It will be specially handled from the start
- Generic, appropriate fallback responses will be used when an error is detected
- Error messages will be prevented from reaching users

## Dynamic Detection

Even if a personality is not pre-configured as problematic, Tzurot can dynamically detect personalities that consistently return errors during runtime.

When a personality returns error content:
1. It is temporarily registered as a problematic personality
2. Appropriate fallback responses are assigned
3. A recovery period is set (typically 2 minutes for transient errors)
4. If the personality encounters multiple errors in succession, the recovery period is extended
5. After the recovery period, the system will attempt normal API calls again

## Logs to Watch

The following log messages indicate a personality might need to be added to the `KNOWN_PROBLEMATIC_PERSONALITIES` list:

```
[AIService] Error in content from {personality-name}: error_in_content
[AIService] Registering runtime problematic personality: {personality-name}
```

If you see these messages repeatedly for the same personality, consider adding it to your `.env` configuration.

## Troubleshooting

If users report that a particular personality:
- Never responds
- Always gives generic responses like "I seem to be experiencing a momentary lapse..."
- Behaves inconsistently compared to other personalities

Check your logs for error patterns related to that personality and consider adding it to the `KNOWN_PROBLEMATIC_PERSONALITIES` environment variable.