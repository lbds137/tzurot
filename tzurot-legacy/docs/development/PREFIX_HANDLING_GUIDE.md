# Bot Prefix Handling Guide

## ⚠️ CRITICAL: Never Hardcode Bot Prefixes!

We've encountered multiple bugs from hardcoded `!tz` prefixes. The bot uses different prefixes in different environments:
- **Production**: `!tz` 
- **Development**: `!rtz`

## The Problem

Hardcoding prefixes causes:
1. **Wrong commands shown to users** in development environment
2. **Broken help text** that doesn't match actual commands
3. **Confusion** when users copy commands that don't work

## Examples of Issues Found

```javascript
// ❌ BAD - Hardcoded prefix
footerText = "Use !tz notifications off to opt out.";
embed.setFooter({ text: 'Use !tz help for more info' });

// ✅ GOOD - Dynamic prefix
footerText = `Use ${this.botPrefix} notifications off to opt out.`;
embed.setFooter({ text: `Use ${botPrefix} help for more info` });
```

## How to Access the Bot Prefix

### In Command Handlers
```javascript
const { botPrefix } = require('../../../config');

// Use in messages
message.reply(`Use ${botPrefix} help for available commands`);
```

### In Classes/Services
```javascript
class MyService {
  constructor(options = {}) {
    this.botPrefix = options.botPrefix || '!tz'; // Accept as option
  }
}
```

### In Singleton Services
```javascript
const { botPrefix } = require('../../../config');

function getInstance() {
  if (!_instance) {
    _instance = new MyService({ botPrefix });
  }
  return _instance;
}
```

## Common Places to Check

1. **Command help text** - Footer messages, usage examples
2. **Error messages** - "Try `!tz help`" → "Try `${botPrefix} help`"
3. **Notification embeds** - DM messages to users
4. **Documentation strings** - Even in comments!

## Enforcement

### Manual Search
```bash
# Find potential hardcoded prefixes
grep -r "!tz\|!rtz" src/ --include="*.js" | grep -v "config.js"
```

### ESLint Rule (To Be Implemented)
```javascript
// .eslintrc.js
{
  rules: {
    'no-hardcoded-prefix': ['error', {
      patterns: ['!tz ', '!rtz ', '"!tz', "'!tz", '`!tz', '`!rtz']
    }]
  }
}
```

## Migration Checklist

When fixing hardcoded prefixes:
- [ ] Import `botPrefix` from config
- [ ] Replace all hardcoded strings
- [ ] Test in both production and dev environments
- [ ] Update any related tests
- [ ] Check for prefixes in error messages
- [ ] Review embed footers and descriptions

## Future Improvements

1. **Create ESLint rule** to catch hardcoded prefixes
2. **Add to pre-commit hooks** for automatic detection
3. **Centralize message templates** to reduce duplication
4. **Consider prefix injection** at the framework level