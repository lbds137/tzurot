---
name: tzurot-security
description: Security best practices for Tzurot v3 - Secret management, AI-specific security (prompt injection, PII scrubbing), Economic DoS prevention, Discord permission verification, microservices security, and supply chain integrity. Use when handling secrets, user input, or security-critical code.
lastUpdated: "2025-11-19"
---

# Security Skill - Tzurot v3

> **Critical Context**: Solo developer + AI assistance = single point of failure for security. This skill codifies security patterns learned from production incidents and AI-specific vulnerabilities.

## 🚨 Tier 1: Core Security (MUST FOLLOW)

### 1. Never Commit Secrets

**CRITICAL**: These incidents have happened TWICE in this project. Always verify before committing.

#### ❌ NEVER Commit These:

**Database Connection Strings:**
```bash
# ❌ WRONG - Contains password
DATABASE_URL="postgresql://user:PASSWORD@host:5432/db"
REDIS_URL="redis://:PASSWORD@host:6379"

# ✅ CORRECT - Use environment variable
DATABASE_URL="your-database-url-here"  # In docs/examples
```

**API Keys and Tokens:**
```typescript
// ❌ WRONG - Hardcoded tokens (NEVER do this!)
const DISCORD_TOKEN = 'your-actual-discord-token-here';
const OPENROUTER_KEY = 'your-actual-openrouter-key-here';

// ✅ CORRECT - Use environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
```

**Other Sensitive Data:**
- Private keys
- Session secrets
- Webhook URLs with tokens
- Real user data in test files
- `.env` files (use `.env.example` instead)

#### Pre-Commit Verification Checklist:

Before EVERY commit, verify:

1. **Run git diff and visually scan** for:
   - `postgresql://` or `postgres://` URLs
   - `redis://` URLs
   - Long alphanumeric strings (potential tokens)
   - `API_KEY`, `TOKEN`, `SECRET` variable assignments

2. **Check staged files**:
   ```bash
   git diff --cached | grep -iE '(password|secret|token|api.?key|postgresql://|redis://)'
   ```

3. **Run npm audit**:
   ```bash
   npm audit --audit-level=moderate
   ```

#### What to Do If You Commit a Secret:

**Immediate Actions:**
1. **DO NOT just delete and commit** - Secret is in git history
2. **Rotate the secret immediately**:
   - Database: Generate new password in Railway
   - API Keys: Regenerate in provider dashboard
   - Discord Token: Regenerate in Discord Developer Portal
3. **Update environment variables** in Railway:
   ```bash
   railway variables set KEY=new-value --service service-name
   ```
4. **Consider git history rewrite** (if recent and not pushed to shared branch):
   ```bash
   # ⚠️ DANGEROUS - Only if commit not shared
   git rebase -i HEAD~3  # Edit commits
   git push --force-with-lease
   ```

### 2. Environment Variable Management

**Pattern: Always use Railway secrets for production**

```typescript
// ✅ CORRECT - Fail fast if missing
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
  'AI_PROVIDER',
] as const;

for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
}

// ✅ CORRECT - Type-safe access
const config = {
  discordToken: process.env.DISCORD_TOKEN!,
  databaseUrl: process.env.DATABASE_URL!,
  redisUrl: process.env.REDIS_URL!,
  aiProvider: process.env.AI_PROVIDER! as 'openrouter' | 'gemini',
};
```

**Railway CLI Usage:**
```bash
# Set secret
railway variables set OPENROUTER_API_KEY=sk-or-v1-... --service ai-worker

# List secrets (values are hidden)
railway variables --service ai-worker

# NEVER use 'echo' to verify - Railway dashboard shows them
```

### 3. Security Logging (No PII, No Tokens)

**CRITICAL**: Logs are stored indefinitely. NEVER log sensitive data.

```typescript
import { logger } from '@tzurot/common-types';

// ❌ WRONG - Logs entire user object (may contain PII)
logger.info({ user }, 'User authenticated');

// ❌ WRONG - Logs token
logger.debug({ token: discordToken }, 'Initializing Discord client');

// ✅ CORRECT - Log only non-sensitive identifiers
logger.info({ userId: user.id, guildId: interaction.guildId }, 'User authenticated');

// ✅ CORRECT - Log masked token (first 10 chars only)
logger.debug({ tokenPrefix: discordToken.slice(0, 10) }, 'Initializing Discord client');
```

**PII to NEVER Log:**
- Email addresses
- Phone numbers
- IP addresses (usually)
- Discord usernames (use IDs instead)
- Message content (unless explicitly needed for debugging)
- API keys, tokens, secrets

**Safe to Log:**
- User IDs (snowflakes)
- Guild IDs
- Channel IDs
- Message IDs
- Timestamps
- Error types/codes

### 4. Rate Limiting / Token Budgeting (Economic DoS Prevention)

**Problem**: AI APIs cost money. Spam = wallet drain.

**Solution**: Implement token budgeting per user/guild in Redis.

```typescript
import { TIMEOUTS } from '@tzurot/common-types';

interface TokenBudget {
  tokensUsed: number;
  windowStart: number;
}

class TokenBudgetService {
  private readonly BUDGET_PER_HOUR = 50_000; // 50k tokens/hour per user
  private readonly WINDOW_MS = 60 * 60 * 1000; // 1 hour

  async checkBudget(userId: string, estimatedTokens: number): Promise<boolean> {
    const key = `token_budget:${userId}`;
    const budgetData = await redis.get(key);

    const budget: TokenBudget = budgetData
      ? JSON.parse(budgetData)
      : { tokensUsed: 0, windowStart: Date.now() };

    // Reset window if expired
    if (Date.now() - budget.windowStart > this.WINDOW_MS) {
      budget.tokensUsed = 0;
      budget.windowStart = Date.now();
    }

    // Check if budget would be exceeded
    if (budget.tokensUsed + estimatedTokens > this.BUDGET_PER_HOUR) {
      return false; // Budget exceeded
    }

    // Update budget
    budget.tokensUsed += estimatedTokens;
    await redis.set(
      key,
      JSON.stringify(budget),
      'PX',
      this.WINDOW_MS
    );

    return true; // Budget available
  }
}

// Usage in API Gateway
app.post('/ai/generate', async (req, res) => {
  const estimatedTokens = estimateTokens(req.body.prompt);

  const hasBudget = await tokenBudgetService.checkBudget(
    req.body.userId,
    estimatedTokens
  );

  if (!hasBudget) {
    return res.status(429).json({
      error: 'Token budget exceeded. Try again in an hour.',
    });
  }

  // Continue processing...
});
```

**Discord Bot Integration:**
```typescript
// In bot-client, inform users of limits
if (!hasBudget) {
  await interaction.reply({
    content: '⚠️ You\'ve reached your hourly token limit (50k tokens). Try again in an hour.',
    ephemeral: true,
  });
  return;
}
```

### 5. Discord Permission Verification

**Problem**: Discord API has race conditions. Don't trust real-time permissions.

**Solution**: Cache permissions and verify server-side.

```typescript
// ❌ WRONG - Trusts client-side permissions
if (interaction.member.permissions.has('Administrator')) {
  // Execute admin command
}

// ✅ CORRECT - Verify on server-side with caching
class PermissionService {
  private permissionCache = new Map<string, { permissions: bigint; expires: number }>();

  async hasPermission(
    guildId: string,
    userId: string,
    permission: PermissionFlagsBits
  ): Promise<boolean> {
    const cacheKey = `${guildId}:${userId}`;
    const cached = this.permissionCache.get(cacheKey);

    // Use cache if valid (5 minute TTL)
    if (cached && Date.now() < cached.expires) {
      return (cached.permissions & BigInt(permission)) === BigInt(permission);
    }

    // Fetch fresh permissions from Discord API
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    const permissions = member.permissions.bitfield;

    // Cache for 5 minutes
    this.permissionCache.set(cacheKey, {
      permissions,
      expires: Date.now() + 5 * 60 * 1000,
    });

    return (permissions & BigInt(permission)) === BigInt(permission);
  }
}

// Usage
const hasAdmin = await permissionService.hasPermission(
  interaction.guildId!,
  interaction.user.id,
  PermissionFlagsBits.Administrator
);

if (!hasAdmin) {
  await interaction.reply({
    content: '❌ You need Administrator permission to use this command.',
    ephemeral: true,
  });
  return;
}
```

**Destructive Command Verification:**

For dangerous commands (wiping memory, changing configs), require confirmation:

```typescript
// Two-step confirmation for destructive commands
app.post('/admin/wipe-memory', async (req, res) => {
  const { userId, guildId, confirmationToken } = req.body;

  // Step 1: Generate confirmation token (first request)
  if (!confirmationToken) {
    const token = randomUUID();
    await redis.set(
      `confirm:${token}`,
      JSON.stringify({ userId, guildId, action: 'wipe-memory' }),
      'EX',
      300 // 5 minute expiry
    );

    return res.json({
      message: 'Confirmation required',
      confirmationToken: token,
    });
  }

  // Step 2: Verify confirmation token (second request)
  const confirmation = await redis.get(`confirm:${confirmationToken}`);
  if (!confirmation) {
    return res.status(400).json({ error: 'Invalid or expired confirmation' });
  }

  // Execute destructive action
  await wipeMemory(guildId);
  await redis.del(`confirm:${confirmationToken}`);

  return res.json({ message: 'Memory wiped successfully' });
});
```

## 🛡️ Tier 2: Important Security (SHOULD IMPLEMENT)

### 6. PII Scrubbing Before Storage/Embedding

**Problem**: Once PII is embedded in pgvector, it's nearly impossible to selectively delete.

**Solution**: Scrub PII before storage using regex/NLP libraries.

```typescript
import { logger } from '@tzurot/common-types';

class PIIScrubber {
  private readonly EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  private readonly PHONE_REGEX = /\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
  private readonly SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

  scrubText(text: string): { scrubbedText: string; hadPII: boolean } {
    let scrubbedText = text;
    let hadPII = false;

    // Scrub emails
    if (this.EMAIL_REGEX.test(scrubbedText)) {
      scrubbedText = scrubbedText.replace(this.EMAIL_REGEX, '<EMAIL_REDACTED>');
      hadPII = true;
    }

    // Scrub phone numbers
    if (this.PHONE_REGEX.test(scrubbedText)) {
      scrubbedText = scrubbedText.replace(this.PHONE_REGEX, '<PHONE_REDACTED>');
      hadPII = true;
    }

    // Scrub SSNs
    if (this.SSN_REGEX.test(scrubbedText)) {
      scrubbedText = scrubbedText.replace(this.SSN_REGEX, '<SSN_REDACTED>');
      hadPII = true;
    }

    if (hadPII) {
      logger.warn({ originalLength: text.length }, 'PII detected and scrubbed from user input');
    }

    return { scrubbedText, hadPII };
  }
}

// Usage in API Gateway (before embedding)
app.post('/memory/add', async (req, res) => {
  const { content, personalityId } = req.body;

  // Scrub PII BEFORE embedding
  const { scrubbedText, hadPII } = piiScrubber.scrubText(content);

  if (hadPII) {
    // Optionally warn user
    logger.info({ personalityId }, 'PII detected and removed from memory');
  }

  // Embed scrubbed text
  const embedding = await generateEmbedding(scrubbedText);
  await memoryService.addMemory(personalityId, scrubbedText, embedding);

  res.json({ success: true });
});
```

**For Advanced PII Detection**: Consider [Microsoft Presidio](https://github.com/microsoft/presidio) for more comprehensive PII detection.

### 7. Prompt Injection Awareness

**Problem**: Users can try "jailbreak" prompts to bypass system instructions.

**Solution**: Implement pre-flight checks and output sanitization.

```typescript
class PromptSecurityService {
  private readonly JAILBREAK_PATTERNS = [
    /ignore (previous|all|earlier|above) (instructions|directions|rules|prompts)/i,
    /dan mode/i,
    /developer mode/i,
    /forget (everything|all|your|previous)/i,
    /new instructions:/i,
    /system:\s*\[/i, // Attempts to inject system messages
  ];

  detectJailbreakAttempt(prompt: string): boolean {
    return this.JAILBREAK_PATTERNS.some(pattern => pattern.test(prompt));
  }

  sanitizeOutput(output: string): string {
    // Remove any attempts to leak system prompts
    const sanitized = output
      .replace(/\[SYSTEM\].*?\[\/SYSTEM\]/gs, '<REDACTED>')
      .replace(/\[INST\].*?\[\/INST\]/gs, '<REDACTED>');

    return sanitized;
  }
}

// Usage in AI Worker
async function processLLMGeneration(job: Job) {
  const { prompt, personalityId } = job.data;

  // Pre-flight check
  if (promptSecurity.detectJailbreakAttempt(prompt)) {
    logger.warn({ personalityId, jobId: job.id }, 'Jailbreak attempt detected');

    return {
      content: '⚠️ Your prompt appears to contain instructions that violate bot policies. Please rephrase.',
      flagged: true,
    };
  }

  // Generate response
  const response = await llmProvider.generate(prompt);

  // Sanitize output before returning
  const sanitized = promptSecurity.sanitizeOutput(response.content);

  return { content: sanitized, flagged: false };
}
```

### 8. Signed Internal Payloads (BullMQ Job Verification)

**Problem**: If Redis is compromised, attacker can inject malicious jobs.

**Solution**: Sign BullMQ jobs with HMAC.

```typescript
import crypto from 'crypto';

class JobSigningService {
  private readonly SECRET = process.env.JOB_SIGNING_SECRET!;

  signPayload(payload: object): string {
    const payloadString = JSON.stringify(payload);
    return crypto
      .createHmac('sha256', this.SECRET)
      .update(payloadString)
      .digest('hex');
  }

  verifySignature(payload: object, signature: string): boolean {
    const expectedSignature = this.signPayload(payload);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}

// API Gateway (job creation)
const jobData = {
  prompt: userPrompt,
  personalityId,
  userId,
  timestamp: Date.now(),
};

const signature = jobSigning.signPayload(jobData);

await aiQueue.add('llm-generation', {
  ...jobData,
  signature, // Include signature in job data
});

// AI Worker (job processing)
async function processJob(job: Job) {
  const { signature, ...payload } = job.data;

  // Verify signature BEFORE processing
  if (!jobSigning.verifySignature(payload, signature)) {
    logger.error({ jobId: job.id }, 'Job signature verification failed - possible tampering');
    throw new Error('Invalid job signature');
  }

  // Process job normally
  // ...
}
```

### 9. Content Validation for Attachments

**Problem**: Users can upload `.exe` files renamed as `.png`.

**Solution**: Validate using "magic numbers" (file headers), not extensions.

```typescript
import fileType from 'file-type'; // npm install file-type

class AttachmentValidator {
  private readonly ALLOWED_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'audio/mpeg', // For voice transcription
    'audio/wav',
    'audio/ogg',
  ];

  async validateAttachment(buffer: Buffer): Promise<{ valid: boolean; detectedType?: string }> {
    // Detect actual file type from magic numbers
    const detected = await fileType.fromBuffer(buffer);

    if (!detected) {
      return { valid: false };
    }

    const valid = this.ALLOWED_TYPES.includes(detected.mime);

    return { valid, detectedType: detected.mime };
  }
}

// Usage in bot-client
client.on('messageCreate', async (message) => {
  if (message.attachments.size > 0) {
    for (const attachment of message.attachments.values()) {
      // Download attachment
      const response = await fetch(attachment.url);
      const buffer = Buffer.from(await response.arrayBuffer());

      // Validate using magic numbers
      const { valid, detectedType } = await attachmentValidator.validateAttachment(buffer);

      if (!valid) {
        await message.reply({
          content: `⚠️ Invalid file type detected: ${detectedType}. Only images and audio files are allowed.`,
        });
        return;
      }

      // Process valid attachment
      // ...
    }
  }
});
```

### 10. Dependency Management (Supply Chain Security)

**Problem**: AI assistants can hallucinate fake npm packages. Compromised packages can steal secrets.

**Solution**: Audit dependencies before installing, pin exact versions.

#### Pre-Installation Checklist:

Before installing ANY package suggested by AI:

1. **Verify it exists**:
   ```bash
   npm view <package-name>
   ```

2. **Check weekly downloads** (on npmjs.com):
   - ✅ >10k/week = Popular, likely safe
   - ⚠️ <1k/week = Investigate further
   - ❌ <100/week = Red flag

3. **Check last publish date**:
   ```bash
   npm view <package-name> time.modified
   ```
   - ⚠️ Not updated in 2+ years = Potentially abandoned

4. **Check for known vulnerabilities**:
   ```bash
   npm audit
   ```

#### Dependency Pinning:

**Always pin exact versions** in `package.json`:

```json
{
  "dependencies": {
    "discord.js": "14.14.1",          // ✅ Exact version
    "bullmq": "5.1.0",                 // ✅ Exact version
    "pino": "8.17.2"                   // ✅ Exact version
  },
  "devDependencies": {
    "vitest": "4.0.3"                  // ✅ Exact version
  }
}
```

**NOT:**
```json
{
  "dependencies": {
    "discord.js": "^14.14.1",   // ❌ Allows minor/patch updates
    "bullmq": "~5.1.0"          // ❌ Allows patch updates
  }
}
```

**Why**: Prevents rogue updates to sub-dependencies from breaking security overnight.

#### Pre-Commit Hook:

Add npm audit to pre-commit checks:

```bash
# .husky/pre-commit or package.json script
#!/bin/sh
npm audit --audit-level=moderate || {
  echo "❌ npm audit found vulnerabilities. Fix them before committing."
  exit 1
}
```

#### Automated Dependency Updates with Dependabot:

**Configuration**: Tzurot v3 uses Dependabot for automated dependency updates and security patches.

See `.github/dependabot.yml` for full configuration.

**Key Features:**
- **Weekly updates** (Mondays at 9am ET) - avoids daily spam
- **Targets `develop` branch** - follows project workflow
- **Grouped updates** - production vs development dependencies
- **Limited open PRs** (2-5 per directory) - manageable for solo dev
- **Auto-assignment** - PRs automatically assigned for review
- **Monorepo support** - separate configs for each service/package

**Benefits:**
```typescript
✅ Automatic security vulnerability patches
✅ Keeps dependencies current
✅ Reduces manual dependency management
✅ Solo dev friendly: manageable PR volume with grouping
✅ Conventional commit format for changelog integration
```

**When Dependabot Creates a PR:**

1. **Review the changelog** - What changed?
2. **Check for breaking changes** - Especially for major version bumps
3. **Run tests locally** (or wait for CI):
   ```bash
   git fetch origin
   git checkout dependabot/npm_and_yarn/services/bot-client/discord.js-14.15.0
   pnpm install
   pnpm test
   ```
4. **Merge if green** - Tests passing = safe to merge
5. **Batch minor/patch updates** - Can merge multiple dependency PRs together

**Security Vulnerabilities:**

Dependabot will create **immediate PRs** for security vulnerabilities (not just weekly updates).

**Priority:** Security PRs should be reviewed and merged ASAP.

**Workflow:**
```bash
# 1. Dependabot creates PR: "chore(deps/ai-worker): bump openai from 4.20.0 to 4.20.1 [security]"
# 2. Review the security advisory linked in the PR
# 3. Check tests pass
# 4. Merge to develop
# 5. Deploy to Railway (auto-deploys from develop)
```

## Related Skills

- **tzurot-observability** - Security logging without PII
- **tzurot-shared-types** - Input validation with Zod schemas
- **tzurot-git-workflow** - Pre-commit verification checks
- **tzurot-async-flow** - Signed internal payloads for BullMQ


## 📚 References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Discord Bot Security Best Practices](https://discord.com/developers/docs/topics/security)
- [Railway Security Guide](https://docs.railway.app/guides/security)
- [BullMQ Security](https://docs.bullmq.io/guide/security)
- [Prompt Injection Primer](https://simonwillison.net/2023/Apr/14/worst-that-can-happen/)
- Post-mortems: See CLAUDE.md "Project Post-Mortems & Lessons Learned" section

## 🚨 Red Flags - When to Consult This Skill

- About to commit changes with credentials
- Implementing user input handling
- Adding new AI provider integration
- Processing file uploads
- Installing new npm packages suggested by AI
- Implementing admin/destructive commands
- Adding new microservice communication
- Logging anything with user data
- Rate limiting concerns
