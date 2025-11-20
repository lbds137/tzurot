# Security Guidelines

This document outlines the security practices, implementations, and guidelines for Tzurot. Security is a top priority, and all contributors should follow these guidelines.

## Table of Contents

- [Security Overview](#security-overview)
- [Authentication System](#authentication-system)
- [Authorization & Permissions](#authorization--permissions)
- [Input Validation & Sanitization](#input-validation--sanitization)
- [Rate Limiting](#rate-limiting)
- [Data Protection](#data-protection)
- [API Security](#api-security)
- [Discord Security](#discord-security)
- [Vulnerability Prevention](#vulnerability-prevention)
- [Security Checklist](#security-checklist)
- [Incident Response](#incident-response)
- [Reporting Security Issues](#reporting-security-issues)

## Security Overview

Tzurot implements multiple layers of security to protect:
- User authentication tokens
- API credentials
- Discord bot token
- User data and conversations
- System resources

### Security Principles

1. **Principle of Least Privilege**: Grant minimum permissions necessary
2. **Defense in Depth**: Multiple security layers
3. **Fail Secure**: Errors should not compromise security
4. **Zero Trust**: Verify everything, trust nothing

## Authentication System

### OAuth-like Flow

Tzurot uses a secure authentication flow for AI service access:

```
User → Bot → Auth URL → Service → Code → Bot → Token
```

#### Security Features

1. **State Parameter**
   - Random state generated for each auth request
   - Prevents CSRF attacks
   - Validated on callback

2. **Code Handling**
   - Authorization codes MUST be submitted via DM
   - Public channel messages with codes are deleted immediately
   - Codes expire after short time window

3. **Token Storage**
   - Tokens stored in memory only
   - No disk persistence
   - Automatic expiration after 30 days

#### Implementation

```javascript
// src/auth.js - Secure code submission
if (message.channel.type !== ChannelType.DM && 
    message.content.includes('auth code')) {
  await message.delete(); // Delete immediately
  return sendSecurityWarning(message.channel);
}
```

### Token Management

1. **Expiration Checking**
   ```javascript
   if (tokenData.expiresAt < Date.now()) {
     delete authTokens[userId];
     throw new Error('Token expired');
   }
   ```

2. **Secure Storage**
   - Never log tokens
   - Use memory-only storage
   - Clear on bot restart

3. **Token Validation**
   - Check expiration on every use
   - Validate token format
   - Handle invalid tokens gracefully

## Authorization & Permissions

### Discord Permissions

#### Command Permissions

Commands check Discord permissions before execution:

```javascript
// Admin commands
permissions: ['ADMINISTRATOR']

// Moderator commands  
permissions: ['MANAGE_MESSAGES']

// User commands
permissions: [] // No special permissions needed
```

#### Bot Permissions

Minimum required permissions:
- View Channels
- Send Messages
- Manage Messages (for auth code deletion)
- Manage Webhooks
- Read Message History

### User Authorization

1. **User-Specific Data**
   - Each user can only manage their own personalities
   - Cannot access other users' data
   - Isolated conversation contexts

2. **Channel Permissions**
   - Channel activation requires Manage Messages permission
   - Respects Discord's permission hierarchy
   - Channel overrides respected

## Input Validation & Sanitization

### User Input Validation

All user input is validated before processing:

```javascript
// Command argument validation
if (!args[0] || args[0].length > 100) {
  throw new ValidationError('Invalid personality name');
}

// Alias validation
if (!/^[\w\s-]+$/.test(alias)) {
  throw new ValidationError('Invalid alias format');
}
```

### Content Sanitization

1. **AI Response Sanitization**
   ```javascript
   function sanitizeResponse(response) {
     // Remove potential command injections
     response = response.replace(/^!tz\s/gm, '');
     
     // Remove @everyone/@here
     response = response.replace(/@(everyone|here)/g, '@\u200b$1');
     
     // Limit length
     return response.substring(0, 2000);
   }
   ```

2. **URL Validation**
   ```javascript
   function isValidUrl(url) {
     // Whitelist allowed protocols
     if (!url.match(/^https?:\/\//)) return false;
     
     // Blacklist dangerous domains
     if (BLOCKED_DOMAINS.some(d => url.includes(d))) return false;
     
     // Validate URL structure
     try {
       new URL(url);
       return true;
     } catch {
       return false;
     }
   }
   ```

### Webhook Security

1. **Name Validation**
   - Webhook names follow strict pattern
   - Prevents impersonation
   - Validates ownership

2. **Avatar URL Validation**
   - Only HTTPS URLs allowed
   - Domain whitelist for avatars
   - Size limits enforced

## Rate Limiting

### Implementation Layers

1. **User-Level Rate Limiting**
   ```javascript
   const limits = {
     commands: { requests: 10, window: 60000 },
     messages: { requests: 30, window: 60000 },
     api: { requests: 20, window: 60000 }
   };
   ```

2. **Channel-Level Rate Limiting**
   - Prevent channel spam
   - Protect against loops
   - Fair usage across channels

3. **Global Rate Limiting**
   - API request limits
   - Discord API limits
   - System resource protection

### Rate Limit Responses

```javascript
if (rateLimited) {
  return message.reply({
    content: 'You are being rate limited. Please try again later.',
    ephemeral: true
  });
}
```

## Data Protection

### Sensitive Data Handling

1. **Never Log Sensitive Data**
   ```javascript
   // Bad
   logger.info(`Auth token: ${token}`);
   
   // Good
   logger.info('Authentication successful');
   ```

2. **Environment Variables**
   - Use `.env` files
   - Never commit secrets
   - Validate on startup

3. **Error Messages**
   - Don't expose internal details
   - User-friendly messages
   - Log full errors internally only

### Data Persistence

1. **File Permissions**
   ```bash
   chmod 600 .env
   chmod 600 data/*.json
   ```

2. **JSON File Security**
   - Validate before saving
   - Atomic writes
   - Backup important data

## API Security

### Request Security

1. **Header Validation**
   ```javascript
   const headers = {
     'Authorization': `Bearer ${token}`,
     'Content-Type': 'application/json',
     'User-Agent': 'Tzurot/1.0'
   };
   ```

2. **Timeout Protection**
   - 30-second default timeout
   - Prevents hanging requests
   - Resource cleanup on timeout

3. **Error Handling**
   - Don't expose API errors to users
   - Log errors securely
   - Graceful degradation

### Authentication Bypass Prevention

```javascript
// Prevent auth header injection
if (message.content.includes('Authorization:')) {
  logger.warn('Potential auth bypass attempt');
  return; // Reject message
}
```

## Discord Security

### Message Security

1. **Mention Protection**
   - Strip @everyone/@here
   - Validate role mentions
   - Prevent mention spam

2. **Embed Validation**
   - Validate embed fields
   - Check URL safety
   - Limit embed count

3. **Attachment Security**
   - Validate file types
   - Check file sizes
   - Scan for malicious content

### Webhook Security

1. **Creation Limits**
   - Track webhook creation
   - Implement cooldowns
   - Clean up unused webhooks

2. **Usage Validation**
   - Verify webhook ownership
   - Check message source
   - Prevent webhook loops

## Vulnerability Prevention

### Common Attack Vectors

1. **Command Injection**
   - Sanitize all inputs
   - Use parameterized commands
   - Validate command structure

2. **XSS Prevention**
   - Escape special characters
   - Validate URLs
   - Sanitize embed content

3. **DoS Protection**
   - Rate limiting
   - Resource limits
   - Timeout protection

### Security Headers

For health check endpoint:
```javascript
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('X-Frame-Options', 'DENY');
res.setHeader('X-XSS-Protection', '1; mode=block');
```

## Security Checklist

### Development

- [ ] No hardcoded secrets
- [ ] Input validation on all user data
- [ ] Error messages don't leak information
- [ ] Proper permission checks
- [ ] Rate limiting implemented

### Deployment

- [ ] Environment variables set
- [ ] File permissions restricted
- [ ] HTTPS for all external calls
- [ ] Monitoring configured
- [ ] Backup strategy in place

### Code Review

- [ ] No sensitive data in logs
- [ ] Authentication properly checked
- [ ] Authorization verified
- [ ] Input sanitization complete
- [ ] Error handling secure

## Incident Response

### Incident Types

1. **Compromised Token**
   - Revoke immediately
   - Generate new token
   - Audit usage logs
   - Notify affected users

2. **Data Breach**
   - Isolate affected systems
   - Assess scope
   - Notify users if needed
   - Implement fixes

3. **Abuse/Spam**
   - Rate limit offender
   - Block if necessary
   - Report to Discord
   - Document incident

### Response Steps

1. **Immediate Actions**
   - Contain the issue
   - Assess severity
   - Begin logging

2. **Investigation**
   - Determine root cause
   - Identify affected users
   - Collect evidence

3. **Remediation**
   - Apply fixes
   - Test thoroughly
   - Deploy updates

4. **Post-Incident**
   - Document lessons learned
   - Update procedures
   - Improve monitoring

## Reporting Security Issues

### Responsible Disclosure

I appreciate responsible disclosure of security vulnerabilities.

#### How to Report

1. **DO NOT** create public issues for security vulnerabilities
2. **DO** create a private security advisory on GitHub
3. Or open a discussion with the security tag
4. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fixes (if any)

#### What to Expect

As this is a personal project, I'll do my best to:
1. **Acknowledge** reports within a few days
2. **Assess** the issue as soon as possible
3. **Fix** based on severity and my availability
4. **Credit** security researchers (if desired)

### Recognition

While I can't offer monetary rewards, I'll gladly:
- Credit you in the changelog
- Add you to a security contributors list
- Give you early access to fixes

### Out of Scope

The following are not considered vulnerabilities:
- Rate limiting bypass through multiple accounts
- Social engineering Discord users
- Physical access attacks
- Denial of service through normal usage

## Security Updates

### Keeping Secure

1. **Dependencies**
   ```bash
   npm audit
   npm audit fix
   ```

2. **Regular Updates**
   - Monitor security advisories
   - Update dependencies
   - Test thoroughly

3. **Security Patches**
   - Apply immediately
   - Test in staging first
   - Document changes

### Security Resources

- [Discord Developer Docs - Security](https://discord.com/developers/docs/topics/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

## Compliance

### GDPR Considerations

- Users can delete their data
- No unnecessary data collection
- Clear data usage policies
- Export functionality available

### Privacy

- Minimal data collection
- No message content logging
- User consent for features
- Transparent data usage

Remember: Security is important. If you spot something concerning, please let me know!