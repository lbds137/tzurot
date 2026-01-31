# AI API Service Implementation Guide

## Project Overview

Build a complete AI API service to replace Shapes.inc, featuring:
- Character-based AI personalities with persistent memory
- Hierarchical memory system (user-specific, group/server-specific, character core)
- Integration with OpenRouter (LLMs), ElevenLabs (voice), Gemini (vision), and Flux (images)
- Discord bot integration via internal Railway API
- Redis caching, PostgreSQL storage, and Qdrant vector database

## Project Structure

```
ai-character-api/
├── api/
│   ├── main.py                 # Single file to start, modularize later
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── discord-bot/
│   ├── index.js               # Existing Discord bot, modified to use local API
│   ├── package.json
│   └── Dockerfile
├── migrations/
│   └── 001_initial_schema.sql
├── railway.toml
├── .gitignore
└── README.md
```

## Complete Single-File Implementation

```python
# api/main.py
"""
AI Character API Service
A complete replacement for Shapes.inc API with modular structure markers
"""

import os
import json
import asyncio
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from contextlib import asynccontextmanager
from enum import Enum
import uuid

# FastAPI and extensions
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# External service clients
from openai import AsyncOpenAI
import google.generativeai as genai
from elevenlabs import AsyncElevenLabs, VoiceSettings
import fal_client
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

# Database and caching
import asyncpg
import redis.asyncio as redis
from sentence_transformers import SentenceTransformer

# Utilities
import httpx
import numpy as np
from loguru import logger

# ========== CONFIGURATION (FUTURE: config.py) ==========

class Config:
    """Centralized configuration - will be moved to config module"""
    # Railway provides these
    DATABASE_URL = os.getenv("DATABASE_URL")
    REDIS_URL = os.getenv("REDIS_URL")
    
    # API Keys
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
    ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
    FAL_API_KEY = os.getenv("FAL_API_KEY")
    INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")
    
    # Qdrant
    QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
    QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
    
    # Model settings
    DEFAULT_LLM_MODEL = "anthropic/claude-3-sonnet-20240229"
    DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
    DEFAULT_VOICE_MODEL = "eleven_turbo_v2_5"
    
    # Memory settings
    MAX_SHORT_TERM_MESSAGES = 20
    MAX_MEMORY_SEARCH_RESULTS = 10
    MEMORY_RELEVANCE_THRESHOLD = 0.7
    
    # Cache settings
    CACHE_TTL_SECONDS = 3600
    
    # Rate limiting
    RATE_LIMIT_REQUESTS = 100
    RATE_LIMIT_WINDOW = 60

# ========== DATA MODELS (FUTURE: models.py) ==========

class InteractionStyle(str, Enum):
    FORMAL = "formal"
    CASUAL = "casual"
    PLAYFUL = "playful"
    SCHOLARLY = "scholarly"
    SUPPORTIVE = "supportive"
    SARCASTIC = "sarcastic"

class UserCreate(BaseModel):
    discord_id: str
    username: str

class UserAPIKeys(BaseModel):
    openrouter_key: Optional[str] = None
    elevenlabs_key: Optional[str] = None
    gemini_key: Optional[str] = None
    fal_key: Optional[str] = None

class CharacterCreate(BaseModel):
    name: str
    description: str
    personality_traits: Dict[str, float]  # trait_name -> strength (0-1)
    interaction_style: InteractionStyle
    voice_characteristics: Dict[str, str]
    knowledge_domains: List[str]
    example_dialogues: List[Dict[str, str]]
    backstory: Optional[str] = None
    voice_id: Optional[str] = None

class MessageRequest(BaseModel):
    user_id: str
    content: str
    guild_id: Optional[str] = None
    channel_id: Optional[str] = None
    attachment_url: Optional[str] = None  # For image analysis

class MessageResponse(BaseModel):
    response: str
    character_id: str
    memories_used: int
    processing_time: float
    tokens_used: Optional[int] = None
    api_keys_status: Dict[str, bool]  # Which APIs are available

# ========== DATABASE SCHEMA (FUTURE: database.py) ==========

SCHEMA_SQL = """
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_id VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User API Keys table (encrypted)
CREATE TABLE IF NOT EXISTS user_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    openrouter_key_encrypted TEXT,
    elevenlabs_key_encrypted TEXT,
    gemini_key_encrypted TEXT,
    fal_key_encrypted TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- API Key usage tracking
CREATE TABLE IF NOT EXISTS api_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    service VARCHAR(50) NOT NULL,
    tokens_used INTEGER,
    cost_estimate DECIMAL(10, 6),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Characters table
CREATE TABLE IF NOT EXISTS characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    personality_traits JSONB NOT NULL,
    interaction_style VARCHAR(50) NOT NULL,
    voice_characteristics JSONB NOT NULL,
    knowledge_domains JSONB NOT NULL,
    example_dialogues JSONB NOT NULL,
    backstory TEXT,
    voice_id VARCHAR(255),
    system_prompt TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID REFERENCES characters(id),
    user_id VARCHAR(255) NOT NULL,
    guild_id VARCHAR(255),
    channel_id VARCHAR(255),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id),
    role VARCHAR(50) NOT NULL, -- 'user' or 'assistant'
    content TEXT NOT NULL,
    tokens_used INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Memories table (for structured storage alongside vector DB)
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID REFERENCES characters(id),
    user_id VARCHAR(255),
    guild_id VARCHAR(255),
    content TEXT NOT NULL,
    embedding_id VARCHAR(255), -- Reference to vector DB
    memory_type VARCHAR(50), -- 'core', 'user', 'group'
    importance FLOAT DEFAULT 0.5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_users_discord ON users(discord_id);
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_guild ON conversations(guild_id);
CREATE INDEX idx_memories_character ON memories(character_id);
CREATE INDEX idx_memories_user ON memories(character_id, user_id);
CREATE INDEX idx_api_usage_user ON api_usage(user_id, timestamp);
"""

# ========== ENCRYPTION (FUTURE: security.py) ==========

from cryptography.fernet import Fernet
import base64

class APIKeyEncryption:
    """Handles secure storage of user API keys"""
    
    def __init__(self):
        # In production, load this from secure storage (e.g., Railway secrets)
        encryption_key = os.getenv("ENCRYPTION_KEY")
        if not encryption_key:
            # Generate a new key for development
            encryption_key = Fernet.generate_key().decode()
            logger.warning("Generated new encryption key - set ENCRYPTION_KEY in production!")
        
        self.cipher = Fernet(encryption_key.encode() if isinstance(encryption_key, str) else encryption_key)
    
    def encrypt(self, api_key: str) -> str:
        """Encrypt an API key for storage"""
        if not api_key:
            return None
        return self.cipher.encrypt(api_key.encode()).decode()
    
    def decrypt(self, encrypted_key: str) -> str:
        """Decrypt an API key for use"""
        if not encrypted_key:
            return None
        return self.cipher.decrypt(encrypted_key.encode()).decode()

# ========== USER MANAGER (FUTURE: users.py) ==========

class UserManager:
    """Manages users and their API keys"""
    
    def __init__(self, db_pool: asyncpg.Pool, encryption: APIKeyEncryption):
        self.db = db_pool
        self.encryption = encryption
        
    async def create_or_update_user(self, discord_id: str, username: str) -> Dict:
        """Create or update a user"""
        
        async with self.db.acquire() as conn:
            user = await conn.fetchrow("""
                INSERT INTO users (discord_id, username)
                VALUES ($1, $2)
                ON CONFLICT (discord_id) 
                DO UPDATE SET 
                    username = $2,
                    last_active = CURRENT_TIMESTAMP
                RETURNING *
            """, discord_id, username)
            
        return dict(user)
    
    async def update_api_keys(self, user_id: str, keys: UserAPIKeys) -> None:
        """Update user's API keys (encrypted)"""
        
        # Encrypt all provided keys
        encrypted_keys = {
            'openrouter': self.encryption.encrypt(keys.openrouter_key) if keys.openrouter_key else None,
            'elevenlabs': self.encryption.encrypt(keys.elevenlabs_key) if keys.elevenlabs_key else None,
            'gemini': self.encryption.encrypt(keys.gemini_key) if keys.gemini_key else None,
            'fal': self.encryption.encrypt(keys.fal_key) if keys.fal_key else None,
        }
        
        async with self.db.acquire() as conn:
            await conn.execute("""
                INSERT INTO user_api_keys (
                    user_id, 
                    openrouter_key_encrypted,
                    elevenlabs_key_encrypted,
                    gemini_key_encrypted,
                    fal_key_encrypted
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id) 
                DO UPDATE SET
                    openrouter_key_encrypted = COALESCE($2, user_api_keys.openrouter_key_encrypted),
                    elevenlabs_key_encrypted = COALESCE($3, user_api_keys.elevenlabs_key_encrypted),
                    gemini_key_encrypted = COALESCE($4, user_api_keys.gemini_key_encrypted),
                    fal_key_encrypted = COALESCE($5, user_api_keys.fal_key_encrypted),
                    updated_at = CURRENT_TIMESTAMP
            """, 
                user_id,
                encrypted_keys['openrouter'],
                encrypted_keys['elevenlabs'],
                encrypted_keys['gemini'],
                encrypted_keys['fal']
            )
    
    async def get_user_api_keys(self, user_id: str) -> Dict[str, str]:
        """Get decrypted API keys for a user"""
        
        async with self.db.acquire() as conn:
            keys = await conn.fetchrow("""
                SELECT * FROM user_api_keys WHERE user_id = $1
            """, user_id)
            
        if not keys:
            return {}
        
        # Decrypt keys
        return {
            'openrouter': self.encryption.decrypt(keys['openrouter_key_encrypted']) if keys['openrouter_key_encrypted'] else None,
            'elevenlabs': self.encryption.decrypt(keys['elevenlabs_key_encrypted']) if keys['elevenlabs_key_encrypted'] else None,
            'gemini': self.encryption.decrypt(keys['gemini_key_encrypted']) if keys['gemini_key_encrypted'] else None,
            'fal': self.encryption.decrypt(keys['fal_key_encrypted']) if keys['fal_key_encrypted'] else None,
        }
    
    async def validate_api_keys(self, keys: Dict[str, str]) -> Dict[str, bool]:
        """Validate which API keys are working"""
        
        status = {}
        
        # Test OpenRouter
        if keys.get('openrouter'):
            try:
                client = AsyncOpenAI(
                    base_url="https://openrouter.ai/api/v1",
                    api_key=keys['openrouter']
                )
                await client.models.list()
                status['openrouter'] = True
            except:
                status['openrouter'] = False
        else:
            status['openrouter'] = False
        
        # Test ElevenLabs
        if keys.get('elevenlabs'):
            try:
                client = AsyncElevenLabs(api_key=keys['elevenlabs'])
                await client.voices.get_all()
                status['elevenlabs'] = True
            except:
                status['elevenlabs'] = False
        else:
            status['elevenlabs'] = False
        
        # Add tests for other services...
        status['gemini'] = bool(keys.get('gemini'))
        status['fal'] = bool(keys.get('fal'))
        
        return status
    
    async def track_usage(self, user_id: str, service: str, 
                         tokens: int = 0, cost: float = 0.0) -> None:
        """Track API usage for billing transparency"""
        
        async with self.db.acquire() as conn:
            await conn.execute("""
                INSERT INTO api_usage (user_id, service, tokens_used, cost_estimate)
                VALUES ($1, $2, $3, $4)
            """, user_id, service, tokens, cost)

# ========== SERVICE CLIENTS (FUTURE: clients.py) ==========

class UserAwareAIClients:
    """Manages AI service clients with user-specific API keys"""
    
    def __init__(self, user_manager: UserManager):
        self.user_manager = user_manager
        self.embedding_model = SentenceTransformer(Config.DEFAULT_EMBEDDING_MODEL)
        
    async def get_openrouter_client(self, user_id: str) -> AsyncOpenAI:
        """Get OpenRouter client with user's API key"""
        
        keys = await self.user_manager.get_user_api_keys(user_id)
        if not keys.get('openrouter'):
            raise HTTPException(
                status_code=402, 
                detail="OpenRouter API key required. Please configure your API keys."
            )
        
        return AsyncOpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=keys['openrouter'],
            default_headers={
                "HTTP-Referer": "https://your-service.com",
                "X-Title": "AI Character Service"
            }
        )
    
    async def get_elevenlabs_client(self, user_id: str) -> AsyncElevenLabs:
        """Get ElevenLabs client with user's API key"""
        
        keys = await self.user_manager.get_user_api_keys(user_id)
        if not keys.get('elevenlabs'):
            raise HTTPException(
                status_code=402,
                detail="ElevenLabs API key required for voice synthesis."
            )
        
        return AsyncElevenLabs(api_key=keys['elevenlabs'])
    
    async def configure_gemini(self, user_id: str) -> None:
        """Configure Gemini with user's API key"""
        
        keys = await self.user_manager.get_user_api_keys(user_id)
        if not keys.get('gemini'):
            raise HTTPException(
                status_code=402,
                detail="Gemini API key required for image analysis."
            )
        
        genai.configure(api_key=keys['gemini'])
    
    async def configure_fal(self, user_id: str) -> None:
        """Configure Fal.ai with user's API key"""
        
        keys = await self.user_manager.get_user_api_keys(user_id)
        if not keys.get('fal'):
            raise HTTPException(
                status_code=402,
                detail="Fal.ai API key required for image generation."
            )
        
        fal_client.api_key = keys['fal']

# ========== CHARACTER MANAGER (FUTURE: character.py) ==========

class CharacterManager:
    """Handles character CRUD and personality management"""
    
    def __init__(self, db_pool: asyncpg.Pool, cache: redis.Redis):
        self.db = db_pool
        self.cache = cache
        
    async def create_character(self, character_data: CharacterCreate) -> Dict:
        """Create a new character with generated system prompt"""
        
        # Generate comprehensive system prompt
        system_prompt = self._generate_system_prompt(character_data)
        
        async with self.db.acquire() as conn:
            character = await conn.fetchrow("""
                INSERT INTO characters (
                    name, description, personality_traits, interaction_style,
                    voice_characteristics, knowledge_domains, example_dialogues,
                    backstory, voice_id, system_prompt
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
            """, 
                character_data.name,
                character_data.description,
                json.dumps(character_data.personality_traits),
                character_data.interaction_style.value,
                json.dumps(character_data.voice_characteristics),
                json.dumps(character_data.knowledge_domains),
                json.dumps(character_data.example_dialogues),
                character_data.backstory,
                character_data.voice_id,
                system_prompt
            )
            
        return dict(character)
    
    async def get_character(self, character_id: str) -> Optional[Dict]:
        """Get character by ID with caching"""
        
        # Check cache first
        cache_key = f"character:{character_id}"
        cached = await self.cache.get(cache_key)
        if cached:
            return json.loads(cached)
        
        # Fetch from database
        async with self.db.acquire() as conn:
            character = await conn.fetchrow(
                "SELECT * FROM characters WHERE id = $1",
                character_id
            )
            
        if character:
            character_dict = dict(character)
            # Cache for 1 hour
            await self.cache.setex(
                cache_key, 
                Config.CACHE_TTL_SECONDS,
                json.dumps(character_dict, default=str)
            )
            return character_dict
            
        return None
    
    def _generate_system_prompt(self, character: CharacterCreate) -> str:
        """Generate a comprehensive system prompt for the character"""
        
        prompt_parts = [
            f"You are {character.name}. {character.description}",
            "",
            "Your personality traits:"
        ]
        
        # Add personality traits with strengths
        for trait, strength in character.personality_traits.items():
            if strength > 0.7:
                intensity = "strongly"
            elif strength > 0.4:
                intensity = "moderately"
            else:
                intensity = "slightly"
            prompt_parts.append(f"- You are {intensity} {trait}")
        
        # Add interaction style
        prompt_parts.extend([
            "",
            f"Your interaction style is {character.interaction_style.value}.",
            "",
            "Voice characteristics:"
        ])
        
        # Add voice characteristics
        for key, value in character.voice_characteristics.items():
            prompt_parts.append(f"- {key}: {value}")
        
        # Add knowledge domains
        if character.knowledge_domains:
            prompt_parts.extend([
                "",
                "You are knowledgeable about:",
                ", ".join(character.knowledge_domains)
            ])
        
        # Add backstory
        if character.backstory:
            prompt_parts.extend([
                "",
                "Your backstory:",
                character.backstory
            ])
        
        # Add example dialogues
        if character.example_dialogues:
            prompt_parts.extend([
                "",
                "Example interaction patterns:"
            ])
            for example in character.example_dialogues[:3]:
                prompt_parts.append(f"User: {example.get('user', '')}")
                prompt_parts.append(f"You: {example.get('assistant', '')}")
                prompt_parts.append("")
        
        return "\n".join(prompt_parts)

# ========== MEMORY SYSTEM (FUTURE: memory.py) ==========

class MemorySystem:
    """Hierarchical memory management with vector search"""
    
    def __init__(self, db_pool: asyncpg.Pool, qdrant: QdrantClient, 
                 embedding_model: SentenceTransformer):
        self.db = db_pool
        self.qdrant = qdrant
        self.embedding_model = embedding_model
        
    async def initialize_collections(self):
        """Create Qdrant collections for each memory type"""
        
        collections = [
            "character_core_memories",
            "character_user_memories", 
            "character_group_memories"
        ]
        
        for collection in collections:
            try:
                await self.qdrant.create_collection(
                    collection_name=collection,
                    vectors_config=VectorParams(
                        size=384,  # all-MiniLM-L6-v2 dimension
                        distance=Distance.COSINE
                    )
                )
                logger.info(f"Created collection: {collection}")
            except Exception as e:
                logger.debug(f"Collection {collection} already exists")
    
    async def store_memory(self, character_id: str, user_id: str, 
                          guild_id: Optional[str], content: str,
                          memory_type: str = "user") -> None:
        """Store a memory in both PostgreSQL and Qdrant"""
        
        # Generate embedding
        embedding = self.embedding_model.encode(content).tolist()
        embedding_id = str(uuid.uuid4())
        
        # Store in PostgreSQL
        async with self.db.acquire() as conn:
            await conn.execute("""
                INSERT INTO memories (
                    character_id, user_id, guild_id, content,
                    embedding_id, memory_type
                ) VALUES ($1, $2, $3, $4, $5, $6)
            """, character_id, user_id, guild_id, content, embedding_id, memory_type)
        
        # Determine collection based on memory type
        if memory_type == "core":
            collection = "character_core_memories"
        elif guild_id:
            collection = "character_group_memories"
        else:
            collection = "character_user_memories"
        
        # Store in Qdrant
        await self.qdrant.upsert(
            collection_name=collection,
            points=[
                PointStruct(
                    id=embedding_id,
                    vector=embedding,
                    payload={
                        "character_id": character_id,
                        "user_id": user_id,
                        "guild_id": guild_id,
                        "content": content,
                        "timestamp": datetime.utcnow().isoformat(),
                        "memory_type": memory_type
                    }
                )
            ]
        )
    
    async def search_memories(self, character_id: str, user_id: str,
                            guild_id: Optional[str], query: str,
                            limit: int = 10) -> List[Dict]:
        """Search for relevant memories across all layers"""
        
        # Generate query embedding
        query_embedding = self.embedding_model.encode(query).tolist()
        
        memories = []
        weights = {
            "core": 0.3,
            "user": 0.5,
            "group": 0.2
        }
        
        # Search core memories
        core_results = await self.qdrant.search(
            collection_name="character_core_memories",
            query_vector=query_embedding,
            query_filter={
                "must": [
                    {"key": "character_id", "match": {"value": character_id}}
                ]
            },
            limit=5
        )
        
        for result in core_results:
            result.payload["relevance_score"] = result.score * weights["core"]
            result.payload["source"] = "core"
            memories.append(result.payload)
        
        # Search user-specific memories
        user_results = await self.qdrant.search(
            collection_name="character_user_memories",
            query_vector=query_embedding,
            query_filter={
                "must": [
                    {"key": "character_id", "match": {"value": character_id}},
                    {"key": "user_id", "match": {"value": user_id}}
                ]
            },
            limit=7
        )
        
        for result in user_results:
            result.payload["relevance_score"] = result.score * weights["user"]
            result.payload["source"] = "user"
            memories.append(result.payload)
        
        # Search group memories if applicable
        if guild_id:
            group_results = await self.qdrant.search(
                collection_name="character_group_memories",
                query_vector=query_embedding,
                query_filter={
                    "must": [
                        {"key": "character_id", "match": {"value": character_id}},
                        {"key": "guild_id", "match": {"value": guild_id}}
                    ]
                },
                limit=5
            )
            
            for result in group_results:
                result.payload["relevance_score"] = result.score * weights["group"]
                result.payload["source"] = "group"
                memories.append(result.payload)
        
        # Sort by relevance and return top memories
        memories.sort(key=lambda x: x["relevance_score"], reverse=True)
        return memories[:limit]

# ========== CONVERSATION HANDLER (FUTURE: conversation.py) ==========

class ConversationHandler:
    """Manages conversation flow and response generation"""
    
    def __init__(self, ai_clients: UserAwareAIClients, memory_system: MemorySystem,
                 character_manager: CharacterManager, user_manager: UserManager, 
                 cache: redis.Redis):
        self.ai = ai_clients
        self.memory = memory_system
        self.characters = character_manager
        self.users = user_manager
        self.cache = cache
        
    async def generate_response(self, character_id: str, 
                              message: MessageRequest) -> MessageResponse:
        """Generate a character response with memory context"""
        
        start_time = datetime.utcnow()
        
        # Get user from database
        user = await self.users.create_or_update_user(
            message.user_id, 
            message.user_id  # Use discord_id as username if not provided
        )
        user_id = str(user['id'])
        
        # Check API key availability
        api_keys = await self.users.get_user_api_keys(user_id)
        api_status = await self.users.validate_api_keys(api_keys)
        
        if not api_status.get('openrouter'):
            raise HTTPException(
                status_code=402,
                detail="OpenRouter API key required. Please configure your keys at /users/keys"
            )
        
        # Get character
        character = await self.characters.get_character(character_id)
        if not character:
            raise HTTPException(status_code=404, detail="Character not found")
        
        # Search relevant memories
        memories = await self.memory.search_memories(
            character_id=character_id,
            user_id=message.user_id,
            guild_id=message.guild_id,
            query=message.content
        )
        
        # Build conversation messages
        messages = self._build_conversation_messages(
            character, message.content, memories
        )
        
        # Handle image attachment if present
        if message.attachment_url and api_status.get('gemini'):
            await self.ai.configure_gemini(user_id)
            image_context = await self._analyze_image(message.attachment_url)
            messages.append({
                "role": "system",
                "content": f"The user has shared an image: {image_context}"
            })
        
        # Generate response with user's OpenRouter key
        try:
            client = await self.ai.get_openrouter_client(user_id)
            completion = await client.chat.completions.create(
                model=Config.DEFAULT_LLM_MODEL,
                messages=messages,
                temperature=self._get_temperature_for_style(
                    character['interaction_style']
                ),
                max_tokens=300,
                presence_penalty=0.1,
                frequency_penalty=0.1
            )
            
            response_content = completion.choices[0].message.content
            tokens_used = completion.usage.total_tokens if completion.usage else None
            
            # Track usage
            if tokens_used:
                # Estimate cost (example rates, adjust based on model)
                cost_per_1k = 0.003  # $0.003 per 1K tokens
                cost = (tokens_used / 1000) * cost_per_1k
                await self.users.track_usage(user_id, 'openrouter', tokens_used, cost)
            
        except Exception as e:
            logger.error(f"OpenRouter error: {e}")
            raise HTTPException(status_code=500, detail="Failed to generate response")
        
        # Store the interaction as memories
        await self._store_interaction(
            character_id, message, response_content
        )
        
        # Calculate processing time
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        
        return MessageResponse(
            response=response_content,
            character_id=character_id,
            memories_used=len(memories),
            processing_time=processing_time,
            tokens_used=tokens_used,
            api_keys_status=api_status
        )
    
    def _build_conversation_messages(self, character: Dict, 
                                   user_message: str,
                                   memories: List[Dict]) -> List[Dict]:
        """Build the messages array for the LLM"""
        
        messages = [
            {"role": "system", "content": character['system_prompt']}
        ]
        
        # Add relevant memories as context
        if memories:
            memory_context = self._format_memories(memories)
            messages.append({
                "role": "system",
                "content": f"Relevant context from previous interactions:\n{memory_context}"
            })
        
        # Add the user message
        messages.append({"role": "user", "content": user_message})
        
        return messages
    
    def _format_memories(self, memories: List[Dict]) -> str:
        """Format memories for context injection"""
        
        formatted = []
        for memory in memories:
            source = memory.get('source', 'unknown')
            content = memory.get('content', '')
            
            if source == 'user':
                prefix = "[Previous conversation with this user]"
            elif source == 'group':
                prefix = "[Shared group memory]"
            elif source == 'core':
                prefix = "[Core knowledge]"
            else:
                prefix = "[Memory]"
                
            formatted.append(f"{prefix} {content}")
        
        return "\n".join(formatted)
    
    def _get_temperature_for_style(self, style: str) -> float:
        """Get appropriate temperature for interaction style"""
        
        temperature_map = {
            'formal': 0.3,
            'casual': 0.7,
            'playful': 0.8,
            'scholarly': 0.4,
            'supportive': 0.6,
            'sarcastic': 0.75
        }
        return temperature_map.get(style, 0.7)
    
    async def _analyze_image(self, image_url: str) -> str:
        """Analyze image using Gemini Vision"""
        
        try:
            # Download image
            async with httpx.AsyncClient() as client:
                response = await client.get(image_url)
                image_data = response.content
            
            # Use Gemini to analyze
            model = genai.GenerativeModel('gemini-2.5-flash')
            response = model.generate_content([
                "Describe this image concisely, focusing on key elements.",
                image_data
            ])
            
            return response.text
            
        except Exception as e:
            logger.error(f"Image analysis failed: {e}")
            return "an image (unable to analyze)"
    
    async def _store_interaction(self, character_id: str,
                               message: MessageRequest,
                               response: str) -> None:
        """Store the interaction for future memory retrieval"""
        
        # Create a summary of the exchange
        exchange_summary = f"User said: {message.content[:100]}... " \
                         f"Character responded: {response[:100]}..."
        
        # Store as memory
        await self.memory.store_memory(
            character_id=character_id,
            user_id=message.user_id,
            guild_id=message.guild_id,
            content=exchange_summary,
            memory_type="group" if message.guild_id else "user"
        )

# ========== VOICE HANDLER (FUTURE: voice.py) ==========

class VoiceHandler:
    """Handles voice synthesis and audio streaming"""
    
    def __init__(self, ai_clients: UserAwareAIClients, user_manager: UserManager):
        self.ai = ai_clients
        self.users = user_manager
        
    async def synthesize_speech(self, user_id: str, text: str, voice_id: str) -> bytes:
        """Generate speech audio from text using user's API key"""
        
        try:
            # Get user's ElevenLabs client
            client = await self.ai.get_elevenlabs_client(user_id)
            
            audio = await client.generate(
                text=text,
                voice=voice_id,
                model=Config.DEFAULT_VOICE_MODEL,
                voice_settings=VoiceSettings(
                    stability=0.5,
                    similarity_boost=0.75,
                    style=0.0,
                    use_speaker_boost=True
                )
            )
            
            # Track usage (ElevenLabs charges per character)
            char_count = len(text)
            cost = (char_count / 1_000_000) * 0.30  # $0.30 per 1M characters
            await self.users.track_usage(user_id, 'elevenlabs', char_count, cost)
            
            return audio
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Voice synthesis failed: {e}")
            raise HTTPException(status_code=500, detail="Voice synthesis failed")

# ========== IMAGE HANDLER (FUTURE: image.py) ==========

class ImageHandler:
    """Handles image generation with Flux"""
    
    def __init__(self, ai_clients: UserAwareAIClients, user_manager: UserManager):
        self.ai = ai_clients
        self.users = user_manager
    
    async def generate_image(self, user_id: str, prompt: str, style: str = "quality") -> str:
        """Generate an image using Flux with user's API key"""
        
        # Configure Fal with user's key
        await self.ai.configure_fal(user_id)
        
        model_map = {
            "fast": "fal-ai/flux/schnell",
            "quality": "fal-ai/flux/dev",
            "pro": "fal-ai/flux/pro"
        }
        
        cost_map = {
            "fast": 0.003,
            "quality": 0.025,
            "pro": 0.055
        }
        
        try:
            result = await fal_client.submit_async(
                model_map.get(style, "fal-ai/flux/dev"),
                arguments={
                    "prompt": prompt,
                    "image_size": "landscape_16_9",
                    "num_inference_steps": 28,
                    "guidance_scale": 3.5,
                    "enable_safety_checker": True
                }
            )
            
            # Track usage
            await self.users.track_usage(user_id, 'fal', 1, cost_map.get(style, 0.025))
            
            return result['images'][0]['url']
            
        except Exception as e:
            logger.error(f"Image generation failed: {e}")
            raise HTTPException(status_code=500, detail="Image generation failed")

# ========== MAIN APPLICATION ==========

# Initialize security
security = HTTPBearer()

# App lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources"""
    
    # Initialize database
    app.state.db = await asyncpg.create_pool(Config.DATABASE_URL)
    
    # Run migrations
    async with app.state.db.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
    
    # Initialize Redis
    app.state.redis = await redis.from_url(Config.REDIS_URL)
    
    # Initialize Qdrant
    app.state.qdrant = QdrantClient(
        url=Config.QDRANT_URL,
        api_key=Config.QDRANT_API_KEY
    )
    
    # Initialize encryption
    app.state.encryption = APIKeyEncryption()
    
    # Initialize user manager
    app.state.user_manager = UserManager(app.state.db, app.state.encryption)
    
    # Initialize AI clients (user-aware, no global keys needed)
    app.state.ai_clients = UserAwareAIClients(app.state.user_manager)
    
    # Initialize services
    app.state.character_manager = CharacterManager(app.state.db, app.state.redis)
    
    # Initialize embedding model (this runs locally)
    embedding_model = SentenceTransformer(Config.DEFAULT_EMBEDDING_MODEL)
    
    app.state.memory_system = MemorySystem(
        app.state.db, app.state.qdrant, embedding_model
    )
    await app.state.memory_system.initialize_collections()
    
    app.state.conversation_handler = ConversationHandler(
        app.state.ai_clients,
        app.state.memory_system,
        app.state.character_manager,
        app.state.user_manager,
        app.state.redis
    )
    
    app.state.voice_handler = VoiceHandler(app.state.ai_clients, app.state.user_manager)
    app.state.image_handler = ImageHandler(app.state.ai_clients, app.state.user_manager)
    
    logger.info("Application initialized successfully")
    
    yield
    
    # Cleanup
    await app.state.db.close()
    await app.state.redis.close()

# Create FastAPI app
app = FastAPI(
    title="AI Character API",
    description="A complete AI character service with memory and personality - BYO API Keys",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("DISCORD_BOT_URL", "*")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== AUTHENTICATION ==========

async def verify_api_key(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify internal API key"""
    if credentials.credentials != Config.INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return credentials.credentials

# ========== USER MANAGEMENT ENDPOINTS ==========

@app.post("/users/register")
async def register_user(
    discord_id: str,
    username: str,
    _: str = Depends(verify_api_key)
):
    """Register a new user"""
    user = await app.state.user_manager.create_or_update_user(discord_id, username)
    return {"user_id": str(user['id']), "discord_id": user['discord_id']}

@app.post("/users/{discord_id}/keys")
async def update_user_keys(
    discord_id: str,
    keys: UserAPIKeys,
    _: str = Depends(verify_api_key)
):
    """Update user's API keys"""
    # Get user
    user = await app.state.user_manager.create_or_update_user(discord_id, discord_id)
    
    # Update keys
    await app.state.user_manager.update_api_keys(str(user['id']), keys)
    
    # Validate keys
    stored_keys = await app.state.user_manager.get_user_api_keys(str(user['id']))
    status = await app.state.user_manager.validate_api_keys(stored_keys)
    
    return {
        "message": "API keys updated",
        "status": status
    }

@app.get("/users/{discord_id}/keys/status")
async def check_user_keys_status(
    discord_id: str,
    _: str = Depends(verify_api_key)
):
    """Check which API keys are configured and valid"""
    # Get user
    user = await app.state.user_manager.create_or_update_user(discord_id, discord_id)
    
    # Get and validate keys
    keys = await app.state.user_manager.get_user_api_keys(str(user['id']))
    status = await app.state.user_manager.validate_api_keys(keys)
    
    return {"status": status}

@app.get("/users/{discord_id}/usage")
async def get_user_usage(
    discord_id: str,
    days: int = 30,
    _: str = Depends(verify_api_key)
):
    """Get user's API usage for the last N days"""
    # Get user
    async with app.state.db.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id FROM users WHERE discord_id = $1",
            discord_id
        )
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get usage data
        usage = await conn.fetch("""
            SELECT 
                service,
                SUM(tokens_used) as total_tokens,
                SUM(cost_estimate) as total_cost,
                COUNT(*) as request_count
            FROM api_usage
            WHERE user_id = $1 
                AND timestamp > CURRENT_TIMESTAMP - INTERVAL '%s days'
            GROUP BY service
        """, user['id'], days)
        
    return {
        "period_days": days,
        "usage": [dict(row) for row in usage]
    }

# ========== CHARACTER ENDPOINTS ==========

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.post("/characters", response_model=Dict)
async def create_character(
    character: CharacterCreate,
    _: str = Depends(verify_api_key)
):
    """Create a new character"""
    result = await app.state.character_manager.create_character(character)
    return result

@app.get("/characters/{character_id}")
async def get_character(
    character_id: str,
    _: str = Depends(verify_api_key)
):
    """Get character details"""
    character = await app.state.character_manager.get_character(character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    return character

@app.post("/characters/{character_id}/chat", response_model=MessageResponse)
async def chat_with_character(
    character_id: str,
    message: MessageRequest,
    _: str = Depends(verify_api_key)
):
    """Main chat endpoint for Discord bot"""
    response = await app.state.conversation_handler.generate_response(
        character_id, message
    )
    return response

@app.post("/characters/{character_id}/voice")
async def generate_voice(
    character_id: str,
    text: str,
    discord_id: str,  # Required to identify the user
    _: str = Depends(verify_api_key)
):
    """Generate voice audio for text"""
    # Get user
    user = await app.state.user_manager.create_or_update_user(discord_id, discord_id)
    
    # Get character
    character = await app.state.character_manager.get_character(character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    
    voice_id = character.get('voice_id', 'rachel')
    audio = await app.state.voice_handler.synthesize_speech(
        str(user['id']), text, voice_id
    )
    
    return StreamingResponse(
        io.BytesIO(audio),
        media_type="audio/mpeg",
        headers={"Content-Disposition": f"attachment; filename=response.mp3"}
    )

@app.post("/generate/image")
async def generate_image(
    prompt: str,
    discord_id: str,
    style: str = "quality",
    _: str = Depends(verify_api_key)
):
    """Generate an image from prompt"""
    # Get user
    user = await app.state.user_manager.create_or_update_user(discord_id, discord_id)
    
    image_url = await app.state.image_handler.generate_image(
        str(user['id']), prompt, style
    )
    return {"image_url": image_url}

@app.post("/characters/{character_id}/memories/search")
async def search_character_memories(
    character_id: str,
    query: str,
    user_id: str,
    guild_id: Optional[str] = None,
    _: str = Depends(verify_api_key)
):
    """Search memories for debugging/inspection"""
    memories = await app.state.memory_system.search_memories(
        character_id, user_id, guild_id, query
    )
    return {"memories": memories}

# ========== MODULARIZATION PLAN ==========
"""
Future modularization structure:

app/
├── __init__.py
├── main.py              # FastAPI app and endpoints
├── config.py            # Configuration management
├── models.py            # Pydantic models and enums
├── database.py          # Database connection and queries
├── clients/
│   ├── __init__.py
│   ├── openrouter.py    # OpenRouter client wrapper
│   ├── elevenlabs.py    # ElevenLabs client wrapper
│   ├── gemini.py        # Gemini client wrapper
│   └── flux.py          # Flux/Fal client wrapper
├── services/
│   ├── __init__.py
│   ├── character.py     # Character management
│   ├── memory.py        # Memory system
│   ├── conversation.py  # Conversation handling
│   ├── voice.py         # Voice synthesis
│   └── image.py         # Image generation
├── middleware/
│   ├── __init__.py
│   ├── auth.py          # Authentication
│   └── ratelimit.py     # Rate limiting
└── utils/
    ├── __init__.py
    ├── cache.py         # Caching utilities
    └── helpers.py       # General helpers
"""

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
```

## Requirements File

```txt
# api/requirements.txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
python-multipart==0.0.6

# AI Service Clients
openai==1.6.1
google-generativeai==0.3.2
elevenlabs==0.2.27
fal-client==0.2.0

# Database and Vector Search
asyncpg==0.29.0
redis[hiredis]==5.0.1
qdrant-client==1.7.0
sentence-transformers==2.2.2

# Utilities
httpx==0.25.2
loguru==0.7.2
numpy==1.24.3
python-dotenv==1.0.0
```

## Dockerfile

```dockerfile
# api/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Run as non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Start application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Environment Variables

```bash
# .env.example
# Database (provided by Railway)
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://host:6379

# External AI APIs
OPENROUTER_API_KEY=your_openrouter_key
ELEVENLABS_API_KEY=your_elevenlabs_key
GEMINI_API_KEY=your_gemini_key
FAL_API_KEY=your_fal_key

# Vector Database
QDRANT_URL=http://qdrant:6333
QDRANT_API_KEY=optional_api_key

# Internal Security
INTERNAL_API_KEY=generate_a_secure_random_key

# Discord Bot
DISCORD_BOT_URL=https://your-bot.railway.app
```

## Railway Configuration

```toml
# railway.toml
[build]
builder = "dockerfile"

[deploy]
numReplicas = 1
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3

[[services]]
name = "api"
source = "api"
port = 8000

[[services]]
name = "discord-bot"
source = "discord-bot"

[[services]]
name = "qdrant"
image = "qdrant/qdrant:latest"
volumes = ["/qdrant/storage"]
```

## Discord Bot Integration Example

```javascript
// discord-bot/index.js - Updated to handle user API keys
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ]
});

// Railway internal networking
const API_URL = process.env.RAILWAY_PRIVATE_DOMAIN 
    ? `http://api.railway.internal:8000`
    : 'http://localhost:8000';

const API_KEY = process.env.INTERNAL_API_KEY;
const SETUP_URL = process.env.SETUP_URL || 'https://your-service.com/setup';

// Map Discord channels/roles to characters
const CHARACTER_MAPPING = {
    'general': 'uuid-for-general-character',
    'support': 'uuid-for-support-character',
    // Add more mappings
};

// Helper to check if user has API keys configured
async function checkUserSetup(discordId) {
    try {
        const response = await axios.get(
            `${API_URL}/users/${discordId}/keys/status`,
            {
                headers: { 'Authorization': `Bearer ${API_KEY}` }
            }
        );
        return response.data.status;
    } catch (error) {
        return null;
    }
}

// Handle the !setup command
async function handleSetupCommand(message) {
    const embed = new EmbedBuilder()
        .setTitle('🔑 API Key Setup Required')
        .setDescription('To use this AI service, you need to provide your own API keys.')
        .addFields(
            { name: 'Why?', value: 'This keeps the service free - you only pay for what you use!' },
            { name: 'Required Keys', value: '• OpenRouter (for AI responses)\n• ElevenLabs (optional, for voice)\n• Gemini (optional, for images)\n• Fal.ai (optional, for image generation)' },
            { name: 'Setup Instructions', value: `1. Visit ${SETUP_URL}\n2. Enter your Discord ID: \`${message.author.id}\`\n3. Add your API keys\n4. Come back and chat!` }
        )
        .setColor(0x5865F2)
        .setFooter({ text: 'Your keys are encrypted and never shared.' });
    
    await message.reply({ embeds: [embed] });
}

// Handle the !usage command
async function handleUsageCommand(message) {
    try {
        const response = await axios.get(
            `${API_URL}/users/${message.author.id}/usage`,
            {
                headers: { 'Authorization': `Bearer ${API_KEY}` }
            }
        );
        
        const usage = response.data.usage;
        let usageText = usage.length > 0 
            ? usage.map(u => `• ${u.service}: ${u.total_cost.toFixed(4)}`).join('\n')
            : 'No usage yet!';
        
        const embed = new EmbedBuilder()
            .setTitle('📊 Your API Usage (Last 30 Days)')
            .setDescription(usageText)
            .setColor(0x00FF00)
            .setFooter({ text: 'Costs are estimates based on current pricing.' });
        
        await message.reply({ embeds: [embed] });
    } catch (error) {
        await message.reply('Could not fetch usage data. Try !setup first.');
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Handle commands
    if (message.content === '!setup') {
        return handleSetupCommand(message);
    }
    
    if (message.content === '!usage') {
        return handleUsageCommand(message);
    }
    
    // Check if user has API keys configured
    const keyStatus = await checkUserSetup(message.author.id);
    
    if (!keyStatus || !keyStatus.openrouter) {
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Setup Required')
            .setDescription('You need to configure your API keys before chatting.')
            .addFields(
                { name: 'Quick Start', value: 'Type `!setup` for instructions' }
            )
            .setColor(0xFFFF00);
        
        return message.reply({ embeds: [embed] });
    }
    
    // Determine character based on channel or mentions
    const characterId = CHARACTER_MAPPING[message.channel.name] || 
                       CHARACTER_MAPPING['general'];
    
    try {
        // Check for image attachments
        let attachmentUrl = null;
        if (message.attachments.size > 0 && keyStatus.gemini) {
            attachmentUrl = message.attachments.first().url;
        }
        
        // Call your API
        const response = await axios.post(
            `${API_URL}/characters/${characterId}/chat`,
            {
                user_id: message.author.id,
                content: message.content,
                guild_id: message.guild?.id,
                channel_id: message.channel.id,
                attachment_url: attachmentUrl
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        // Send response
        await message.reply(response.data.response);
        
        // If some services are unavailable, notify user
        const unavailable = Object.entries(response.data.api_keys_status)
            .filter(([_, status]) => !status)
            .map(([service, _]) => service);
        
        if (unavailable.length > 0 && Math.random() < 0.1) { // 10% chance to remind
            await message.channel.send(
                `💡 Tip: Add ${unavailable.join(', ')} keys for more features! Type \`!setup\``
            );
        }
        
    } catch (error) {
        console.error('API Error:', error.response?.data || error.message);
        
        if (error.response?.status === 402) {
            await message.reply("⚠️ API key issue! Type `!setup` to check your configuration.");
        } else {
            await message.reply("I'm having trouble responding right now!");
        }
    }
});

// Handle DMs for private key setup assistance
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.inGuild()) return;
    
    if (message.content.startsWith('!setkey')) {
        await message.reply(
            "⚠️ Never share API keys in Discord!\n" +
            `Please visit ${SETUP_URL} to securely add your keys.`
        );
    }
});

client.login(process.env.DISCORD_TOKEN);
```

## Simple Web Interface for API Key Management

```html
<!-- setup-page/index.html - Host this on GitHub Pages or similar -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Service - API Key Setup</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background: #0d1117;
            color: #c9d1d9;
        }
        .container {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 20px;
        }
        h1 {
            color: #58a6ff;
            margin-top: 0;
        }
        input {
            width: 100%;
            padding: 8px 12px;
            margin: 8px 0;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            color: #c9d1d9;
            font-size: 14px;
        }
        button {
            background: #238636;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            width: 100%;
            margin-top: 10px;
        }
        button:hover {
            background: #2ea043;
        }
        .status {
            margin: 10px 0;
            padding: 10px;
            border-radius: 6px;
            display: none;
        }
        .success {
            background: #1f6feb;
            display: block;
        }
        .error {
            background: #da3633;
            display: block;
        }
        .key-status {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 5px 0;
        }
        .indicator {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .indicator.active {
            background: #3fb950;
        }
        .indicator.inactive {
            background: #f85149;
        }
        .info {
            background: #1f6feb;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
        }
        a {
            color: #58a6ff;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔑 API Key Setup</h1>
        
        <div class="info">
            <strong>Why do I need API keys?</strong><br>
            This service is free to use - you just bring your own API keys! 
            You only pay for what you use directly to the API providers.
        </div>
        
        <form id="keyForm">
            <label for="discordId">Discord ID:</label>
            <input type="text" id="discordId" placeholder="Your Discord ID (e.g., 123456789)" required>
            
            <h3>API Keys</h3>
            
            <label for="openrouter">OpenRouter API Key (Required):</label>
            <input type="password" id="openrouter" placeholder="sk-or-...">
            <small>Get one at <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys</a></small>
            
            <label for="elevenlabs">ElevenLabs API Key (Optional - for voice):</label>
            <input type="password" id="elevenlabs" placeholder="Your ElevenLabs key">
            <small>Get one at <a href="https://elevenlabs.io/api" target="_blank">elevenlabs.io</a></small>
            
            <label for="gemini">Gemini API Key (Optional - for image analysis):</label>
            <input type="password" id="gemini" placeholder="Your Gemini key">
            <small>Get one at <a href="https://makersuite.google.com/app/apikey" target="_blank">Google AI Studio</a></small>
            
            <label for="fal">Fal.ai API Key (Optional - for image generation):</label>
            <input type="password" id="fal" placeholder="Your Fal.ai key">
            <small>Get one at <a href="https://fal.ai/dashboard" target="_blank">fal.ai</a></small>
            
            <button type="submit">Save API Keys</button>
        </form>
        
        <div id="status" class="status"></div>
        
        <div id="keyStatus" style="display: none; margin-top: 20px;">
            <h3>Key Status:</h3>
            <div class="key-status">
                <div class="indicator" id="openrouterStatus"></div>
                <span>OpenRouter</span>
            </div>
            <div class="key-status">
                <div class="indicator" id="elevenlabsStatus"></div>
                <span>ElevenLabs</span>
            </div>
            <div class="key-status">
                <div class="indicator" id="geminiStatus"></div>
                <span>Gemini</span>
            </div>
            <div class="key-status">
                <div class="indicator" id="falStatus"></div>
                <span>Fal.ai</span>
            </div>
        </div>
    </div>
    
    <script>
        // Configure your API endpoint
        const API_URL = 'https://your-service.railway.app';
        const API_KEY = 'your-internal-api-key'; // In production, use a proxy to hide this
        
        async function checkKeyStatus(discordId) {
            try {
                const response = await fetch(`${API_URL}/users/${discordId}/keys/status`, {
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    displayKeyStatus(data.status);
                }
            } catch (error) {
                console.error('Error checking key status:', error);
            }
        }
        
        function displayKeyStatus(status) {
            document.getElementById('keyStatus').style.display = 'block';
            
            for (const [service, isActive] of Object.entries(status)) {
                const indicator = document.getElementById(`${service}Status`);
                if (indicator) {
                    indicator.className = `indicator ${isActive ? 'active' : 'inactive'}`;
                }
            }
        }
        
        document.getElementById('keyForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const statusDiv = document.getElementById('status');
            statusDiv.className = 'status';
            statusDiv.textContent = 'Saving keys...';
            statusDiv.style.display = 'block';
            
            const discordId = document.getElementById('discordId').value;
            const keys = {
                openrouter_key: document.getElementById('openrouter').value || null,
                elevenlabs_key: document.getElementById('elevenlabs').value || null,
                gemini_key: document.getElementById('gemini').value || null,
                fal_key: document.getElementById('fal').value || null
            };
            
            try {
                const response = await fetch(`${API_URL}/users/${discordId}/keys`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(keys)
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    statusDiv.className = 'status success';
                    statusDiv.textContent = '✅ Keys saved successfully! You can now use the bot.';
                    displayKeyStatus(data.status);
                    
                    // Clear sensitive fields
                    document.getElementById('openrouter').value = '';
                    document.getElementById('elevenlabs').value = '';
                    document.getElementById('gemini').value = '';
                    document.getElementById('fal').value = '';
                } else {
                    throw new Error(data.detail || 'Failed to save keys');
                }
            } catch (error) {
                statusDiv.className = 'status error';
                statusDiv.textContent = `❌ Error: ${error.message}`;
            }
        });
        
        // Check status on Discord ID change
        document.getElementById('discordId').addEventListener('change', (e) => {
            if (e.target.value) {
                checkKeyStatus(e.target.value);
            }
        });
    </script>
</body>
</html>
```

## Initial Database Migration

```sql
-- migrations/001_initial_schema.sql
-- Run this after first deployment to set up the database
-- The schema is already in main.py but this is for reference

-- Note: Don't add sample characters yet - users need to set up API keys first!
-- Instead, create characters via the API after users have configured their keys

-- You can add a system message to guide new users:
INSERT INTO characters (
    id,
    name,
    description,
    personality_traits,
    interaction_style,
    voice_characteristics,
    knowledge_domains,
    example_dialogues,
    system_prompt
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Setup Assistant',
    'A helpful guide for setting up API keys',
    '{"helpful": 1.0, "patient": 0.9, "clear": 0.9}',
    'supportive',
    '{"tone": "friendly", "pace": "slow", "formality": "casual"}',
    '["API setup", "configuration help", "troubleshooting"]',
    '[{"user": "How do I start?", "assistant": "Hi! To use this AI service, you need to set up your API keys first. Type !setup for instructions!"}]',
    'You are a setup assistant. Your only job is to help users configure their API keys. Always respond with instructions to type !setup or visit the setup page. Be friendly but brief.'
);
```

## Quick Start Commands for Claude Code

```bash
# 1. Initialize the project
mkdir ai-character-api
cd ai-character-api

# 2. Create the single-file implementation
# Copy the entire main.py from this guide

# 3. Create requirements.txt
# Copy from this guide

# 4. Create Dockerfile
echo 'FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y gcc g++ && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]' > Dockerfile

# 5. Create .gitignore
echo '__pycache__/
*.pyc
.env
.venv/
venv/
*.log
.DS_Store' > .gitignore

# 6. Initialize git and push
git init
git add .
git commit -m "Initial AI character API with BYO keys"
git remote add origin YOUR_GITHUB_URL
git push -u origin main

# 7. Deploy to Railway
railway login
railway init
railway link
railway up
```

## Cost Structure for Users

With this BYO (Bring Your Own) API key model:

**What You Pay For:**
- Railway hosting: ~$5-20/month (for PostgreSQL, Redis, and compute)
- Qdrant: Free tier usually sufficient, or ~$25/month for larger deployments

**What Users Pay For (directly to providers):**
- OpenRouter: $0.002-0.06 per 1K tokens based on model choice
- ElevenLabs: $5/month starter plan or pay-as-you-go
- Gemini: Free tier includes 1M tokens/month
- Fal.ai: Pay per image generated

**Example User Costs:**
- Casual user (100 messages/day): ~$1-3/month
- Power user (1000 messages/day): ~$10-30/month
- With voice/images: Add $5-20/month

**Benefits of This Model:**
- Users control their costs
- No markup on API usage
- Service remains sustainable
- Transparent pricing
- Users can use their existing API subscriptions

## Security Best Practices

1. **API Key Encryption**: All user API keys are encrypted at rest using Fernet
2. **No Key Logging**: Never log API keys, even encrypted ones
3. **Secure Transport**: Always use HTTPS for the web interface
4. **Key Rotation**: Encourage users to rotate keys regularly
5. **Minimal Permissions**: Request only necessary permissions

## Deployment Steps

1. **Create Railway Project**
   ```bash
   railway login
   railway init
   railway link
   ```

2. **Add Services via Railway Dashboard**
   - PostgreSQL (automatic)
   - Redis (automatic)
   - Qdrant (from Docker image)

3. **Set Environment Variables** in Railway dashboard
   - Only need `INTERNAL_API_KEY` and `ENCRYPTION_KEY`
   - No external API keys required!

4. **Deploy**
   ```bash
   railway up
   ```

5. **Create Setup Page**
   - Host the HTML setup page on GitHub Pages or Vercel
   - Update `SETUP_URL` in your Discord bot

6. **Test the Flow**
   - User types message in Discord
   - Bot prompts for API key setup
   - User visits setup page and adds keys
   - User can now chat with characters!

## Modularization Roadmap

As the codebase grows, split the single file into modules:

1. **Phase 1**: Extract configuration, models, and security
   - `config.py`: Configuration management
   - `models.py`: Pydantic models
   - `security.py`: Encryption and auth

2. **Phase 2**: Separate service clients
   - `clients/openrouter.py`
   - `clients/elevenlabs.py`
   - `clients/gemini.py`
   - `clients/flux.py`

3. **Phase 3**: Split business logic
   - `services/users.py`: User management
   - `services/characters.py`: Character management
   - `services/memory.py`: Memory system
   - `services/conversation.py`: Chat logic

4. **Phase 4**: Add middleware and utilities
   - `middleware/ratelimit.py`: Per-user rate limiting
   - `utils/usage_tracker.py`: Cost tracking

5. **Phase 5**: Comprehensive testing
   - Unit tests for each module
   - Integration tests for API endpoints
   - Mock external API calls

Each phase maintains backward compatibility while improving code organization.

## Summary

This implementation provides:
- ✅ Complete character personality system with memory
- ✅ User-provided API keys (no platform costs)
- ✅ Secure key storage with encryption
- ✅ Usage tracking and cost transparency
- ✅ Easy Discord bot integration
- ✅ Simple web interface for key management
- ✅ Railway deployment ready
- ✅ Modular architecture ready for growth

The BYO API key model ensures the service remains free to operate while users maintain full control over their AI usage and costs.
