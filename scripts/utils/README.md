# Utility Scripts

General-purpose utilities for dependency management, configuration, and data mappings.

## Scripts

- **update-deps.ts** - Update project dependencies across all workspaces
- **set-default-llm-config.ts** - Set default LLM configuration for personalities
- **verify-llm-default-constraint.ts** - Verify database constraints on LLM defaults
- **uuid-mappings.json** - UUID mappings for v2 to v3 migration (not tracked)
- **uuid-mappings.example.json** - Example UUID mappings structure

## Usage

```bash
# Update dependencies
npx tsx scripts/utils/update-deps.ts

# Set default LLM config
npx tsx scripts/utils/set-default-llm-config.ts

# Verify LLM constraints
npx tsx scripts/utils/verify-llm-default-constraint.ts
```
