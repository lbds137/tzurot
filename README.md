# Tzurot v3 - Clean Architecture Rewrite

A modern, scalable Discord bot with customizable AI personalities, built with TypeScript and a clean microservices architecture.

## Key Improvements Over v2

- **Vendor Independence**: No more vendor lock-in! Clean abstraction layer for AI providers
- **TypeScript Throughout**: Full type safety and better IDE support
- **True Microservices**: Each service has a single responsibility
- **OpenRouter Integration**: Access to 400+ models through one API
- **Clean Separation**: No more half-finished DDD refactoring

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│  Discord    │────▶│  Bot Client  │────▶│    API     │
│   Users     │◀────│   Service    │◀────│  Gateway   │
└─────────────┘     └──────────────┘     └────────────┘
                                               │
                                               ▼
                                         ┌────────────┐
                                         │   Queue    │
                                         │  (BullMQ)  │
                                         └────────────┘
                                               │
                                               ▼
                                         ┌────────────┐
                                         │ AI Worker  │
                                         │  Service   │
                                         └────────────┘
                                               │
                                               ▼
                                         ┌────────────┐
                                         │ OpenRouter │
                                         │    API     │
                                         └────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Redis (for BullMQ)
- Discord Bot Token
- OpenRouter API Key

### Setup

1. **Install dependencies:**
   ```bash
   cd tzurot-v3
   pnpm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your tokens and keys
   ```

3. **Start services:**
   ```bash
   # Development mode (all services)
   pnpm dev
   
   # Or start individually:
   pnpm --filter @tzurot/bot-client dev
   pnpm --filter @tzurot/api-gateway dev
   pnpm --filter @tzurot/ai-worker dev
   ```

## Project Structure

- **`services/`** - Microservices
  - `bot-client/` - Discord bot interface
  - `api-gateway/` - HTTP API and request routing
  - `ai-worker/` - Background AI processing
  
- **`packages/`** - Shared code
  - `common-types/` - TypeScript types and schemas
  - `api-clients/` - External API client libraries

## AI Provider System

The system is designed to be vendor-agnostic:

```typescript
// Easy to switch providers
const provider = AIProviderFactory.create('openrouter', {
  apiKey: process.env.OPENROUTER_API_KEY
});

// Or use a different provider
const provider = AIProviderFactory.create('openai', {
  apiKey: process.env.OPENAI_API_KEY
});
```

### Currently Supported
- ✅ OpenRouter (400+ models)

### Planned Support
- ⏳ Direct OpenAI
- ⏳ Direct Anthropic
- ⏳ Local models (Ollama)
- ⏳ Custom endpoints

## Personality System

Personalities are fully customizable with:
- Custom system prompts
- Model selection
- Temperature and token limits
- Rate limiting per personality
- Memory and context management
- Channel and user restrictions

## Development

### Build all services:
```bash
pnpm build
```

### Run tests:
```bash
pnpm test
```

### Type checking:
```bash
pnpm typecheck
```

### Formatting:
```bash
pnpm format
```

## Deployment

### Railway

The project includes Railway configuration for easy deployment:

```bash
# Deploy all services
railway up
```

### Docker (Coming Soon)

Docker compose configuration will be added for self-hosting.

## Migration from v2

1. Export personalities from v2
2. Convert to new schema format
3. Import into v3 database
4. Update Discord bot token
5. Switch deployment

## License

[Your License]

## Contributing

[Your Contributing Guidelines]