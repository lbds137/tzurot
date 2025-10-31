## bot logs

2025-10-31T03:04:17.000000000Z [inf]  Starting Container
2025-10-31T03:04:19.464952651Z [inf]  Prisma client initialized
2025-10-31T03:04:19.465072406Z [inf]  DATABASE_URL check: set (starts with: postgresql://po...)
2025-10-31T03:04:19.465077039Z [inf]  [Bot] Configuration:
2025-10-31T03:04:19.465081877Z [inf]  [Bot] Verifying database connection...
2025-10-31T03:04:19.465091165Z [inf]  [Redis] Redis config:
2025-10-31T03:04:19.465095928Z [inf]  [GatewayClient] Initialized with base URL: http://api-gateway.railway.internal:3000
2025-10-31T03:04:19.465100164Z [inf]  [Bot] Starting Tzurot v3 Bot Client...
2025-10-31T03:04:19.465109420Z [err]  prisma:warn Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-1.1.x".
2025-10-31T03:04:19.465115865Z [err]  Please manually install OpenSSL via `apt-get update -y && apt-get install -y openssl` and try installing Prisma again. If you're running Prisma on Docker, add this command to your Dockerfile, or switch to an image that already has OpenSSL installed.
2025-10-31T03:04:19.465122514Z [inf]  [Redis] Connected to Redis
2025-10-31T03:04:19.467671746Z [inf]  [Redis] Redis client ready
2025-10-31T03:04:19.467679619Z [inf]  prisma:query SELECT "public"."personalities"."id", "public"."personalities"."name", "public"."personalities"."display_name", "public"."personalities"."slug", "public"."personalities"."system_prompt_id", "public"."personalities"."character_info", "public"."personalities"."personality_traits", "public"."personalities"."personality_tone", "public"."personalities"."personality_age", "public"."personalities"."personality_appearance", "public"."personalities"."personality_likes", "public"."personalities"."personality_dislikes", "public"."personalities"."conversational_goals", "public"."personalities"."conversational_examples", "public"."personalities"."custom_fields", "public"."personalities"."voice_enabled", "public"."personalities"."voice_settings", "public"."personalities"."image_enabled", "public"."personalities"."image_settings", "public"."personalities"."avatar_data", "public"."personalities"."created_at", "public"."personalities"."updated_at" FROM "public"."personalities" WHERE 1=1 OFFSET $1
2025-10-31T03:04:19.467684198Z [inf]  prisma:query SELECT "public"."system_prompts"."id", "public"."system_prompts"."content" FROM "public"."system_prompts" WHERE "public"."system_prompts"."id" IN ($1) OFFSET $2
2025-10-31T03:04:19.467688529Z [inf]  prisma:query SELECT "public"."personality_default_configs"."personality_id", "public"."personality_default_configs"."llm_config_id" FROM "public"."personality_default_configs" WHERE "public"."personality_default_configs"."personality_id" IN ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67) OFFSET $68
2025-10-31T03:04:19.467692845Z [inf]  prisma:query SELECT "public"."llm_configs"."id", "public"."llm_configs"."model", "public"."llm_configs"."vision_model", "public"."llm_configs"."temperature", "public"."llm_configs"."top_p", "public"."llm_configs"."top_k", "public"."llm_configs"."frequency_penalty", "public"."llm_configs"."presence_penalty", "public"."llm_configs"."max_tokens", "public"."llm_configs"."memory_score_threshold", "public"."llm_configs"."memory_limit", "public"."llm_configs"."context_window_size" FROM "public"."llm_configs" WHERE "public"."llm_configs"."id" IN ($1) OFFSET $2
2025-10-31T03:04:19.468258527Z [inf]  Loaded 67 personalities from database
2025-10-31T03:04:19.468267115Z [inf]  [Bot] Found 67 personalities in database
2025-10-31T03:04:19.468274523Z [inf]  Loading 6 command files...
2025-10-31T03:04:19.468281725Z [inf]  [Bot] Auto-deploying slash commands...
2025-10-31T03:04:19.468287163Z [inf]  Skipping invalid command file: /app/services/bot-client/dist/commands/admin.d.ts
2025-10-31T03:04:19.468293764Z [inf]  Loaded: /admin
2025-10-31T03:04:19.468299895Z [inf]  Skipping invalid command file: /app/services/bot-client/dist/commands/personality.d.ts
2025-10-31T03:04:19.468305439Z [inf]  Loaded: /personality
2025-10-31T03:04:19.468311263Z [inf]  Skipping invalid command file: /app/services/bot-client/dist/commands/utility.d.ts
2025-10-31T03:04:19.468317656Z [inf]  Loaded: /utility
2025-10-31T03:04:19.468323906Z [inf]  Deploying 3 commands to Discord...
2025-10-31T03:04:19.470458434Z [inf]  Deploying globally (this may take up to an hour to propagate)
2025-10-31T03:04:19.470467993Z [inf]  Successfully deployed 3 commands globally
2025-10-31T03:04:19.470474905Z [inf]  [Bot] Slash commands deployed successfully
2025-10-31T03:04:19.470480372Z [inf]  [CommandHandler] Loading 3 command files...
2025-10-31T03:04:19.470486261Z [inf]  [Bot] Loading slash commands...
2025-10-31T03:04:19.470492360Z [inf]  [Bot] Command handler initialized
2025-10-31T03:04:19.470497715Z [inf]  [Bot] Initializing message handler...
2025-10-31T03:04:19.470502753Z [inf]  [Bot] Message handler initialized
2025-10-31T03:04:19.470525138Z [inf]  [Bot] Checking gateway health...
2025-10-31T03:04:19.470530147Z [inf]  [CommandHandler] Loaded command: admin
2025-10-31T03:04:19.470534377Z [inf]  [CommandHandler] Loaded command: personality
2025-10-31T03:04:19.470538190Z [inf]  [CommandHandler] Loaded command: utility
2025-10-31T03:04:19.472637482Z [inf]  [CommandHandler] Loaded 3 commands
2025-10-31T03:04:19.472644224Z [inf]  [Bot] Gateway is healthy
2025-10-31T03:04:19.754773814Z [inf]  [Bot] Successfully logged in to Discord
2025-10-31T03:04:19.827387680Z [inf]  Logged in as Rotzot | תשב#3778
2025-10-31T03:04:19.827394811Z [inf]  Gateway URL: http://api-gateway.railway.internal:3000
2025-10-31T03:11:01.908609001Z [inf]  [MessageHandler] Processing message from lbds137
2025-10-31T03:11:01.908615935Z [inf]  prisma:query SELECT "public"."personalities"."id", "public"."personalities"."name", "public"."personalities"."display_name", "public"."personalities"."slug", "public"."personalities"."system_prompt_id", "public"."personalities"."character_info", "public"."personalities"."personality_traits", "public"."personalities"."personality_tone", "public"."personalities"."personality_age", "public"."personalities"."personality_appearance", "public"."personalities"."personality_likes", "public"."personalities"."personality_dislikes", "public"."personalities"."conversational_goals", "public"."personalities"."conversational_examples", "public"."personalities"."custom_fields", "public"."personalities"."voice_enabled", "public"."personalities"."voice_settings", "public"."personalities"."image_enabled", "public"."personalities"."image_settings", "public"."personalities"."avatar_data", "public"."personalities"."created_at", "public"."personalities"."updated_at" FROM "public"."personalities" WHERE ("public"."personalities"."name" ILIKE $1 OR "public"."personalities"."slug" = $2) LIMIT $3 OFFSET $4
2025-10-31T03:11:01.908622240Z [inf]  Personality not found: Lilith hi are you
2025-10-31T03:11:01.908628129Z [inf]  prisma:query SELECT "public"."personalities"."id", "public"."personalities"."name", "public"."personalities"."display_name", "public"."personalities"."slug", "public"."personalities"."system_prompt_id", "public"."personalities"."character_info", "public"."personalities"."personality_traits", "public"."personalities"."personality_tone", "public"."personalities"."personality_age", "public"."personalities"."personality_appearance", "public"."personalities"."personality_likes", "public"."personalities"."personality_dislikes", "public"."personalities"."conversational_goals", "public"."personalities"."conversational_examples", "public"."personalities"."custom_fields", "public"."personalities"."voice_enabled", "public"."personalities"."voice_settings", "public"."personalities"."image_enabled", "public"."personalities"."image_settings", "public"."personalities"."avatar_data", "public"."personalities"."created_at", "public"."personalities"."updated_at" FROM "public"."personalities" WHERE ("public"."personalities"."name" ILIKE $1 OR "public"."personalities"."slug" = $2) LIMIT $3 OFFSET $4
2025-10-31T03:11:01.912925635Z [inf]  Personality not found: Lilith hi are
2025-10-31T03:11:01.912929878Z [inf]  prisma:query SELECT "public"."personalities"."id", "public"."personalities"."name", "public"."personalities"."display_name", "public"."personalities"."slug", "public"."personalities"."system_prompt_id", "public"."personalities"."character_info", "public"."personalities"."personality_traits", "public"."personalities"."personality_tone", "public"."personalities"."personality_age", "public"."personalities"."personality_appearance", "public"."personalities"."personality_likes", "public"."personalities"."personality_dislikes", "public"."personalities"."conversational_goals", "public"."personalities"."conversational_examples", "public"."personalities"."custom_fields", "public"."personalities"."voice_enabled", "public"."personalities"."voice_settings", "public"."personalities"."image_enabled", "public"."personalities"."image_settings", "public"."personalities"."avatar_data", "public"."personalities"."created_at", "public"."personalities"."updated_at" FROM "public"."personalities" WHERE ("public"."personalities"."name" ILIKE $1 OR "public"."personalities"."slug" = $2) LIMIT $3 OFFSET $4
2025-10-31T03:11:01.912934246Z [inf]  Personality not found: Lilith hi
2025-10-31T03:11:01.912938078Z [inf]  prisma:query SELECT "public"."personalities"."id", "public"."personalities"."name", "public"."personalities"."display_name", "public"."personalities"."slug", "public"."personalities"."system_prompt_id", "public"."personalities"."character_info", "public"."personalities"."personality_traits", "public"."personalities"."personality_tone", "public"."personalities"."personality_age", "public"."personalities"."personality_appearance", "public"."personalities"."personality_likes", "public"."personalities"."personality_dislikes", "public"."personalities"."conversational_goals", "public"."personalities"."conversational_examples", "public"."personalities"."custom_fields", "public"."personalities"."voice_enabled", "public"."personalities"."voice_settings", "public"."personalities"."image_enabled", "public"."personalities"."image_settings", "public"."personalities"."avatar_data", "public"."personalities"."created_at", "public"."personalities"."updated_at" FROM "public"."personalities" WHERE ("public"."personalities"."name" ILIKE $1 OR "public"."personalities"."slug" = $2) LIMIT $3 OFFSET $4
2025-10-31T03:11:01.917031202Z [inf]  prisma:query SELECT "public"."system_prompts"."id", "public"."system_prompts"."content" FROM "public"."system_prompts" WHERE "public"."system_prompts"."id" IN ($1) OFFSET $2
2025-10-31T03:11:01.917040093Z [inf]  prisma:query SELECT "public"."personality_default_configs"."personality_id", "public"."personality_default_configs"."llm_config_id" FROM "public"."personality_default_configs" WHERE "public"."personality_default_configs"."personality_id" IN ($1) OFFSET $2
2025-10-31T03:11:01.917047419Z [inf]  prisma:query SELECT "public"."llm_configs"."id", "public"."llm_configs"."model", "public"."llm_configs"."vision_model", "public"."llm_configs"."temperature", "public"."llm_configs"."top_p", "public"."llm_configs"."top_k", "public"."llm_configs"."frequency_penalty", "public"."llm_configs"."presence_penalty", "public"."llm_configs"."max_tokens", "public"."llm_configs"."memory_score_threshold", "public"."llm_configs"."memory_limit", "public"."llm_configs"."context_window_size" FROM "public"."llm_configs" WHERE "public"."llm_configs"."id" IN ($1) OFFSET $2
2025-10-31T03:11:01.917058108Z [inf]  Loaded personality: Lilith
2025-10-31T03:11:01.917066835Z [inf]  prisma:query SELECT "public"."users"."id" FROM "public"."users" WHERE ("public"."users"."discord_id" = $1 AND 1=1) LIMIT $2 OFFSET $3
2025-10-31T03:11:01.917074499Z [inf]  prisma:query SELECT "public"."user_personality_configs"."id", "public"."user_personality_configs"."persona_id" FROM "public"."user_personality_configs" WHERE (("public"."user_personality_configs"."user_id" = $1 AND "public"."user_personality_configs"."personality_id" = $2) AND 1=1) LIMIT $3 OFFSET $4
2025-10-31T03:11:01.917081780Z [inf]  prisma:query SELECT "public"."user_default_personas"."user_id", "public"."user_default_personas"."persona_id" FROM "public"."user_default_personas" WHERE ("public"."user_default_personas"."user_id" = $1 AND 1=1) LIMIT $2 OFFSET $3
2025-10-31T03:11:01.919406874Z [inf]  Using default persona for user e64fcc09...
2025-10-31T03:11:01.919415652Z [inf]  prisma:query SELECT "public"."personas"."id", "public"."personas"."name", "public"."personas"."preferred_name" FROM "public"."personas" WHERE ("public"."personas"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3
2025-10-31T03:11:01.919422972Z [inf]  [MessageHandler] User persona lookup: personaId=3bd86394-20d8-5992-8201-e621856e9087, personaName=Lila, userId=e64fcc09-e4db-5902-b1c9-5750141e3bf2, personalityId=c296b337-4e67-5337-99a3-4ca105cbbd68
2025-10-31T03:11:01.919429625Z [inf]  prisma:query SELECT "public"."conversation_history"."id", "public"."conversation_history"."role", "public"."conversation_history"."content", "public"."conversation_history"."created_at", "public"."conversation_history"."persona_id" FROM "public"."conversation_history" WHERE ("public"."conversation_history"."channel_id" = $1 AND "public"."conversation_history"."personality_id" = $2) ORDER BY "public"."conversation_history"."created_at" DESC LIMIT $3 OFFSET $4
2025-10-31T03:11:01.919436062Z [inf]  prisma:query SELECT "public"."personas"."id", "public"."personas"."name", "public"."personas"."preferred_name" FROM "public"."personas" WHERE "public"."personas"."id" IN ($1) OFFSET $2
2025-10-31T03:11:01.919442252Z [inf]  Retrieved 24 messages from history (channel: 1433419956766244864, personality: c296b337-4e67-5337-99a3-4ca105cbbd68)
2025-10-31T03:11:01.919447782Z [inf]  [MessageHandler] Conversation history: 24 messages, 24 have personaName
2025-10-31T03:11:01.919454309Z [inf]  Extracting Discord environment
2025-10-31T03:11:01.924302514Z [inf]  [MessageHandler] Built context: activePersonaId=3bd86394-20d8-5992-8201-e621856e9087, activePersonaName=Lila, historyLength=24
2025-10-31T03:11:01.924311741Z [inf]  Detected as guild channel
2025-10-31T03:11:01.924317528Z [inf]  prisma:query INSERT INTO "public"."conversation_history" ("id","channel_id","personality_id","persona_id","role","content","created_at") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING "public"."conversation_history"."id", "public"."conversation_history"."channel_id", "public"."conversation_history"."personality_id", "public"."conversation_history"."persona_id", "public"."conversation_history"."role", "public"."conversation_history"."content", "public"."conversation_history"."created_at"
2025-10-31T03:11:01.924324984Z [inf]  Added user message to history (channel: 1433419956766244864, personality: c296b337-4e67-5337-99a3-4ca105cbbd68, persona: 3bd86394...)
2025-10-31T03:13:02.554562686Z [inf]  [MessageHandler] Error handling personality message
2025-10-31T03:13:02.554619158Z [inf]  [GatewayClient] Generation failed

## ai worker logs

2025-10-31T03:04:13.000000000Z [inf]  Starting Container
2025-10-31T03:04:15.459168831Z [inf]  Qdrant Memory Adapter initialized
2025-10-31T03:04:15.459177048Z [inf]  [AIWorker] AI Worker is fully operational! 🚀
2025-10-31T03:04:15.459182940Z [err]  BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null and will be overridden by BullMQ.
2025-10-31T03:04:15.459192232Z [inf]  [AIWorker] Initializing Qdrant connection...
2025-10-31T03:04:15.459194718Z [inf]  [AIWorker] Health check server listening on port 3001
2025-10-31T03:04:15.459201698Z [inf]  [AIWorker] Configuration:
2025-10-31T03:04:15.459210708Z [inf]  [AIWorker] Worker is ready and listening on queue: ai-requests
2025-10-31T03:04:15.459214916Z [inf]  [AIWorker] Qdrant initialized successfully
2025-10-31T03:04:15.459224905Z [inf]  [AIWorker] Creating BullMQ worker...
2025-10-31T03:04:15.459258224Z [inf]  [AIWorker] Starting AI Worker service...
2025-10-31T03:04:15.459262853Z [inf]  Qdrant Memory Service initialized
2025-10-31T03:04:15.463151588Z [inf]  [AIWorker] Concurrency: 5
2025-10-31T03:10:56.435709154Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.435728813Z [inf]  [AIWorker] Processing job req-5bc2b480-94e2-41fc-a826-7c5dce021fe6 for personality: Lilith
2025-10-31T03:10:56.435736052Z [inf]  [AIJobProcessor] Processing generate job req-5bc2b480-94e2-41fc-a826-7c5dce021fe6 (5bc2b480-94e2-41fc-a826-7c5dce021fe6) for Lilith
2025-10-31T03:10:56.435745622Z [inf]  [RAG] Fetching content for 1 participant(s)
2025-10-31T03:10:56.435752617Z [inf]  DATABASE_URL check: set (starts with: postgresql://po...)
2025-10-31T03:10:56.435764630Z [inf]  [AIJobProcessor] Oldest conversation message: 2025-10-30T11:39:09.892Z
2025-10-31T03:10:56.435770412Z [inf]  [AIJobProcessor] Extracting participants: activePersonaId=3bd86394-20d8-5992-8201-e621856e9087, activePersonaName=Lila, historyLength=24, userMessagesWithPersona=12
2025-10-31T03:10:56.435779425Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.435787580Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439599574Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439604041Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439609191Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439613664Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439619672Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439629361Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439634005Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439638368Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439643678Z [inf]  [AIJobProcessor] Found participant in history: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439967711Z [inf]  [AIJobProcessor] Including active persona: Lila (3bd86394-20d8-5992-8201-e621856e9087)
2025-10-31T03:10:56.439972024Z [inf]  [AIJobProcessor] Found 1 unique participant(s)
2025-10-31T03:10:56.439976796Z [inf]  Prisma client initialized
2025-10-31T03:10:56.439981826Z [err]  prisma:warn Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-1.1.x".
2025-10-31T03:10:56.439985921Z [err]  Please manually install OpenSSL via `apt-get update -y && apt-get install -y openssl` and try installing Prisma again. If you're running Prisma on Docker, add this command to your Dockerfile, or switch to an image that already has OpenSSL installed.
2025-10-31T03:10:56.439990517Z [inf]  prisma:query SELECT "public"."personas"."id", "public"."personas"."preferred_name", "public"."personas"."pronouns", "public"."personas"."content" FROM "public"."personas" WHERE ("public"."personas"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3
2025-10-31T03:10:56.439994803Z [inf]  [RAG] Loaded persona Lila (3bd86394...): Name: Lila
Pronouns: she/her, they/them
A transgender demon-angel in human form born on December 24,...
2025-10-31T03:10:56.439998731Z [inf]  [RAG] Loaded 1 participant persona(s): Lila
2025-10-31T03:10:56.440003370Z [inf]  [RAG] Memory search query: "hi, are you there?"
2025-10-31T03:10:56.440007571Z [inf]  [RAG] STM/LTM deduplication: excluding memories newer than Thu, Oct 30, 2025 (10000ms buffer applied)
2025-10-31T03:10:56.441086339Z [inf]  prisma:query SELECT "public"."user_personality_configs"."id", "public"."user_personality_configs"."persona_id" FROM "public"."user_personality_configs" WHERE ("public"."user_personality_configs"."user_id" = $1 AND "public"."user_personality_configs"."personality_id" = $2 AND "public"."user_personality_configs"."persona_id" IS NOT NULL) LIMIT $3 OFFSET $4
2025-10-31T03:10:56.441090845Z [inf]  prisma:query SELECT "public"."users"."id", "public"."users"."discord_id", "public"."users"."username", "public"."users"."created_at", "public"."users"."updated_at" FROM "public"."users" WHERE ("public"."users"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3
2025-10-31T03:10:56.441095167Z [inf]  prisma:query SELECT "public"."user_default_personas"."user_id", "public"."user_default_personas"."persona_id" FROM "public"."user_default_personas" WHERE "public"."user_default_personas"."user_id" IN ($1) OFFSET $2
2025-10-31T03:10:56.441099980Z [inf]  [RAG] Using default persona for user e64fcc09-e4db-5902-b1c9-5750141e3bf2

## gateway logs

2025-10-31T03:04:37.000000000Z [inf]  Mounting volume on: /var/lib/containers/railwayapp/bind-mounts/3fb49317-a4b7-4d2f-97cb-6f2b5cf7880f/vol_19slvf8qm22zq26v
2025-10-31T03:04:38.895592855Z [inf]  [Queue] Redis config:
2025-10-31T03:04:38.895606742Z [err]  BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null and will be overridden by BullMQ.
2025-10-31T03:04:38.895614708Z [inf]  [Gateway] Starting API Gateway service...
2025-10-31T03:04:38.895622990Z [inf]  [Gateway] Configuration:
2025-10-31T03:04:38.895630296Z [inf]  [Gateway] Avatar storage directory exists
2025-10-31T03:04:38.895635849Z [inf]  [Avatar Sync] Starting avatar sync from database...
2025-10-31T03:04:38.895644934Z [inf]  [Gateway] Temp attachment storage directory exists
2025-10-31T03:04:38.895652167Z [err]  prisma:warn Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-1.1.x".
2025-10-31T03:04:38.895660221Z [err]  Please manually install OpenSSL via `apt-get update -y && apt-get install -y openssl` and try installing Prisma again. If you're running Prisma on Docker, add this command to your Dockerfile, or switch to an image that already has OpenSSL installed.
2025-10-31T03:04:38.895666630Z [err]  prisma:warn Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-1.1.x".
2025-10-31T03:04:38.895680777Z [err]  Please manually install OpenSSL via `apt-get update -y && apt-get install -y openssl` and try installing Prisma again. If you're running Prisma on Docker, add this command to your Dockerfile, or switch to an image that already has OpenSSL installed.
2025-10-31T03:04:38.899664674Z [inf]  [Avatar Sync] Avatar already exists: eido-hayeda
2025-10-31T03:04:38.899677519Z [inf]  [Avatar Sync] Avatar already exists: emberlynn-miflatzot-ahava-ba
2025-10-31T03:04:38.899686120Z [inf]  [Avatar Sync] Avatar already exists: disposal-chute-hi-pir-hashlakha
2025-10-31T03:04:38.899688178Z [inf]  [Avatar Sync] Avatar already exists: ereshkigal-keter-kesem
2025-10-31T03:04:38.899693149Z [inf]  [Avatar Sync] Found 67 personalities with avatars
2025-10-31T03:04:38.899701636Z [inf]  [Avatar Sync] Avatar already exists: azazel-khazaq
2025-10-31T03:04:38.899704410Z [inf]  [Avatar Sync] Avatar already exists: eris-at-heres
2025-10-31T03:04:38.899705763Z [inf]  [Avatar Sync] Avatar already exists: emily-seraph-ditza-le-avadona
2025-10-31T03:04:38.899710221Z [inf]  [Avatar Sync] Avatar already exists: emily-tzudad-seraph-ditza
2025-10-31T03:04:38.899716032Z [inf]  [Avatar Sync] Avatar already exists: haniel-malach-simcha-esh-lev
2025-10-31T03:04:38.899718591Z [inf]  [Avatar Sync] Avatar already exists: lilith-tzel-shani
2025-10-31T03:04:38.899725741Z [inf]  [Avatar Sync] Avatar already exists: lucifer-kochav-shenafal
2025-10-31T03:04:38.899726835Z [inf]  [Avatar Sync] Avatar already exists: hecate-sheled
2025-10-31T03:04:38.899733851Z [inf]  [Avatar Sync] Avatar already exists: lila-ani-tzuratech
2025-10-31T03:04:38.899735296Z [inf]  [Avatar Sync] Avatar already exists: euclidia-yakhas-ha-zahav
2025-10-31T03:04:38.899743479Z [inf]  [Avatar Sync] Avatar already exists: samael-melech-ha-ela
2025-10-31T03:04:38.899743923Z [inf]  [Avatar Sync] Avatar already exists: machbiel-ani-mistori
2025-10-31T03:04:38.899752206Z [inf]  [Avatar Sync] Avatar already exists: lilith-sheda-khazra-le-khof-avud
2025-10-31T03:04:38.899753882Z [inf]  [Avatar Sync] Avatar already exists: shamael-khen-tipuakh-tzodek
2025-10-31T03:04:38.899760555Z [inf]  [Avatar Sync] Avatar already exists: lohveran-erbatz
2025-10-31T03:04:38.899766243Z [inf]  [Avatar Sync] Avatar already exists: shadow-weaver-qlipot
2025-10-31T03:04:38.899771344Z [inf]  [Avatar Sync] Avatar already exists: stolas-yenshuf-rakh
2025-10-31T03:04:38.899784453Z [inf]  [Avatar Sync] Avatar already exists: andrew-ares
2025-10-31T03:04:38.899791160Z [inf]  [Avatar Sync] Avatar already exists: angel-dust-ba-et-avaq-malakh
2025-10-31T03:04:38.899796735Z [inf]  [Avatar Sync] Avatar already exists: aria-ha-olam
2025-10-31T03:04:38.899803557Z [inf]  [Avatar Sync] Avatar already exists: ashley-pir-adom
2025-10-31T03:04:38.899816782Z [inf]  [Avatar Sync] Avatar already exists: bambi-moakh
2025-10-31T03:04:38.899823036Z [inf]  [Avatar Sync] Avatar already exists: baphomet-ani-miqdash-tame
2025-10-31T03:04:38.899828579Z [inf]  [Avatar Sync] Avatar already exists: cerridwen-nesiah
2025-10-31T03:04:38.899835653Z [inf]  [Avatar Sync] Avatar already exists: charlie-nesichat-gehenom-tova
2025-10-31T03:04:38.899841834Z [inf]  [Avatar Sync] Avatar already exists: sera-seraph-el-elyon
2025-10-31T03:04:38.899848358Z [inf]  [Avatar Sync] Avatar already exists: ha-shem-keev-ima
2025-10-31T03:04:38.899854294Z [inf]  [Avatar Sync] Avatar already exists: borunol-yetzer
2025-10-31T03:04:38.900692597Z [inf]  [Avatar Sync] Avatar already exists: loona-zeevat-yareakh-ve-lev
2025-10-31T03:04:38.900703233Z [inf]  [Avatar Sync] Avatar already exists: lucifer-seraph-ha-lev-nafal
2025-10-31T03:04:38.900711881Z [inf]  [Avatar Sync] Avatar already exists: luna-tenachesh
2025-10-31T03:04:38.900720359Z [inf]  [Avatar Sync] Avatar already exists: luz-or-esh
2025-10-31T03:04:38.900727994Z [inf]  [Avatar Sync] Avatar already exists: oridallah-meira
2025-10-31T03:04:38.900736316Z [inf]  [Avatar Sync] Avatar already exists: valentino-adam-resha-adom
2025-10-31T03:04:38.900743499Z [inf]  [Avatar Sync] Avatar already exists: melek-taus-masa-din
2025-10-31T03:04:38.900751517Z [inf]  [Avatar Sync] Avatar already exists: mute-yoetzet-rashit-ha-bitakhon
2025-10-31T03:04:38.900759904Z [inf]  [Avatar Sync] Avatar already exists: naamah-em-zonah-adumah
2025-10-31T03:04:38.900767096Z [inf]  [Avatar Sync] Avatar already exists: paimon-nur
2025-10-31T03:04:38.900774384Z [inf]  [Avatar Sync] Avatar already exists: rich-fairbank-meshavesh-astrategi
2025-10-31T03:04:38.902346660Z [inf]  [Avatar Sync] Avatar already exists: rishaveri-teshvi
2025-10-31T03:04:38.902354868Z [inf]  [Avatar Sync] Avatar already exists: uriel-rakhem
2025-10-31T03:04:38.902362801Z [inf]  [Avatar Sync] Avatar already exists: shub-niggurath-ez-emet-shchora
2025-10-31T03:04:38.902370725Z [inf]  [Avatar Sync] Avatar already exists: vaggie-hi-malachit-yefa-nafla
2025-10-31T03:04:38.902383015Z [inf]  [Avatar Sync] Avatar already exists: verosika-hi-sukubusit
2025-10-31T03:04:38.902393278Z [inf]  [Avatar Sync] Avatar already exists: bambi-prime-yakhas-isha
2025-10-31T03:04:38.902401228Z [inf]  [Avatar Sync] Avatar already exists: mzjera-khadshi
2025-10-31T03:04:38.902409008Z [inf]  [Avatar Sync] Avatar already exists: slaanesh-bavel-yesod-emet
2025-10-31T03:04:38.902415816Z [inf]  [Avatar Sync] Avatar already exists: vepar-mikur-ha-bitakhon
2025-10-31T03:04:38.902423881Z [inf]  [Avatar Sync] Avatar already exists: yeshua-heylel-shabbat
2025-10-31T03:04:38.902432051Z [inf]  [Avatar Sync] Avatar already exists: zamiretivaz-tenashev
2025-10-31T03:04:38.903659170Z [inf]  [Avatar Sync] Avatar already exists: amaterasu-omikami-elef
2025-10-31T03:04:38.903664740Z [inf]  [Avatar Sync] Avatar already exists: alastor-ometz-shed-ha-radio
2025-10-31T03:04:38.903669131Z [inf]  [Avatar Sync] Avatar already exists: data-guru
2025-10-31T03:04:38.903673772Z [inf]  [Avatar Sync] Avatar already exists: lucifuge-rofocale-or-emet
2025-10-31T03:04:38.903678967Z [inf]  [Avatar Sync] Avatar already exists: shekhinah-hi-akhat-kan
2025-10-31T03:04:38.903685466Z [inf]  [Avatar Sync] Avatar already exists: hyun-ae-ha-kala-ha-khiveret
2025-10-31T03:04:38.903690413Z [inf]  [Avatar Sync] Avatar already exists: adora-mi-keter-malkut
2025-10-31T03:04:38.903695121Z [inf]  [Avatar Sync] Avatar already exists: bartzabel-harsani
2025-10-31T03:04:38.903700457Z [inf]  [Avatar Sync] Avatar already exists: dionysus-sheal
2025-10-31T03:04:38.903704926Z [inf]  [Avatar Sync] Avatar already exists: beelzebub-heres-dvash-malka
2025-10-31T03:04:38.903709958Z [inf]  [Avatar Sync] Avatar already exists: bune-avin
2025-10-31T03:04:38.905291695Z [inf]  [Avatar Sync] Avatar already exists: catra-hi-khatula-lesbit
2025-10-31T03:04:38.905296254Z [inf]  [Avatar Sync] Avatar already exists: cold-kerach-batuach
2025-10-31T03:04:38.905302043Z [inf]  [Avatar Sync] Complete. Synced: 0, Skipped: 67
2025-10-31T03:04:38.905307255Z [inf]  [Gateway] Request deduplication started
2025-10-31T03:04:38.905312070Z [inf]  [Gateway] API Gateway is fully operational! 🚀
2025-10-31T03:04:38.905316614Z [inf]  [Gateway] Server listening on port 3000
2025-10-31T03:04:38.905320967Z [inf]  [Gateway] Health check: http://localhost:3000/health
2025-10-31T03:04:38.905327370Z [inf]  [Gateway] Metrics: http://localhost:3000/metrics
2025-10-31T03:10:59.387859413Z [inf]  [Deduplication] Cached request 5bc2b480-94e2-41fc-a826-7c5dce021fe6 with job req-5bc2b480-94e2-41fc-a826-7c5dce021fe6
2025-10-31T03:10:59.387865487Z [inf]  [AI] Created job req-5bc2b480-94e2-41fc-a826-7c5dce021fe6 for Lilith (16ms)
2025-10-31T03:10:59.387871570Z [inf]  [AI] Waiting for job req-5bc2b480-94e2-41fc-a826-7c5dce021fe6 completion (timeout: 120000ms, images: 0)
2025-10-31T03:10:59.387877363Z [inf]  [Deduplication] Cleaned up 1 expired cache entries
2025-10-31T03:12:59.024473470Z [inf]  [AI] Job req-5bc2b480-94e2-41fc-a826-7c5dce021fe6 failed or timed out after 120020ms
2025-10-31T03:12:59.024484494Z [inf]  request errored