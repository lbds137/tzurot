# Authentication & Security Features

This directory contains documentation for authentication, authorization, and security features.

## Authentication System

- [AUTHENTICATION](AUTHENTICATION.md) - Complete authentication system documentation
- [PLURALKIT_PROXY_HANDLING](PLURALKIT_PROXY_HANDLING.md) - Integration with PluralKit proxy system

## Overview

Tzurot implements a sophisticated authentication system that provides:

- **OAuth-like Flow**: Secure token-based authentication
- **User Verification**: DM-only authorization code submission
- **Session Management**: Automatic token expiration and renewal
- **Permission Controls**: Role-based command access
- **Integration Support**: Works alongside PluralKit and other proxy bots

## Key Features

### Authentication Flow
1. User initiates auth with `!tz auth start`
2. System generates secure authorization code
3. User submits code via DM for verification
4. System issues API access token
5. Token enables personality management and AI interactions

### Security Measures
- **DM-Only Verification**: Prevents channel-based token interception
- **Time-Limited Codes**: Authorization codes expire quickly
- **Token Rotation**: Automatic renewal and secure storage
- **Permission Validation**: Each command checks user authorization
- **Rate Limiting**: Prevents abuse and ensures fair usage

### PluralKit Compatibility
- **Non-Conflicting**: Works alongside PluralKit without interference
- **Message Detection**: Recognizes and respects PluralKit proxy messages
- **User Mapping**: Correctly attributes messages to original users
- **Seamless Integration**: No configuration required

## Security Best Practices

### For Users
- Only submit auth codes in DMs to the bot
- Don't share your API tokens
- Use `!tz auth status` to check your session

### For Developers
- Never log auth tokens or codes
- Validate all user permissions before command execution
- Implement proper session timeouts
- Use secure random generation for codes

## Related Documentation

- [Core Security](../../core/SECURITY.md) - Overall security guidelines
- [API Reference](../../core/API_REFERENCE.md) - Authentication endpoints
- [Command System](../../core/COMMAND_SYSTEM.md) - Permission-based commands
- [Troubleshooting](../../core/TROUBLESHOOTING.md) - Auth issues and solutions