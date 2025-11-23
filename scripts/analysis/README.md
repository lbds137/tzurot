# Code Analysis Scripts

Scripts for analyzing code quality, patterns, and potential issues.

## Scripts

- **check-singleton-exports.js** - Find singleton export patterns
- **check-hardcoded-prefix.js** - Detect hardcoded bot prefix usage (should use config)
- **check-module-size.sh** - Analyze module bundle sizes
- **check-job-validation.sh** - Verify BullMQ job validation patterns

## Usage

```bash
# Check for singletons
node scripts/analysis/check-singleton-exports.js

# Find hardcoded prefixes
node scripts/analysis/check-hardcoded-prefix.js

# Check module sizes
./scripts/analysis/check-module-size.sh
```

**⚠️ See:** `tzurot-constants` skill for magic number detection and centralization patterns
