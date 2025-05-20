# System Architecture

## Overview

Tzurot is a Discord bot that uses webhooks to represent multiple AI personalities. It allows users to add personalities and interact with them through Discord channels.

## Core Components

1. **Bot** - Main entry point for Discord interaction
2. **Personality Manager** - Manages AI personalities
3. **Webhook Manager** - Handles Discord webhooks for personality messages
4. **AI Service** - Interface with the AI API
5. **Conversation Manager** - Tracks active conversations
6. **Commands** - Processes Discord commands
7. **Profile Info Fetcher** - Fetches profile information

## Data Flow

1. User sends message to Discord
2. Discord.js client receives message event
3. Message is processed by bot.js
4. AI response is generated via aiService.js
5. Response is sent via webhook using webhookManager.js
6. Conversation data is recorded in conversationManager.js

## Component Relationships

(Describe how components interact with each other)

## Key Design Patterns

1. **Error Prevention**
2. **Caching**
3. **Modular Architecture**
