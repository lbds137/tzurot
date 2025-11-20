// Load environment variables
require('dotenv').config();

// Environment detection
const isDevelopment = process.env.NODE_ENV === 'development';

// Bot configuration - all values come from environment variables
const botConfig = {
  // Bot identification
  name: process.env.BOT_NAME || (isDevelopment ? 'Rotzot' : 'Tzurot'),
  prefix: process.env.BOT_PREFIX || (isDevelopment ? '!rtz' : '!tz'),
  mentionChar: process.env.BOT_MENTION_CHAR || (isDevelopment ? '&' : '@'),
  token: process.env.DISCORD_TOKEN,
  
  // Environment flag
  isDevelopment,
  environment: process.env.NODE_ENV || 'production'
};

// Legacy export for backward compatibility
const botPrefix = botConfig.prefix;

// Function to get the API endpoint
function getApiEndpoint() {
  return `${process.env.SERVICE_API_BASE_URL}/v1`;
}

// Function to get the service identifier
function getServiceId() {
  return process.env.SERVICE_ID;
}

// Function to get the personality jargon term (e.g., "personalities", "agents", "characters")
function getPersonalityJargonTerm() {
  return process.env.PERSONALITY_JARGON_TERM;
}

// Function to get the complete model path for a personality
function getModelPath(personalityName) {
  return `${getServiceId()}/${personalityName}`;
}

// Function to get the profile info endpoint for a personality (public)
function getProfileInfoEndpoint(personalityName) {
  const jargonTerm = getPersonalityJargonTerm();
  return `${process.env.SERVICE_WEBSITE}/api/public/${jargonTerm}/${personalityName}`;
}

// Function to get the private profile info path for backup operations
function getPrivateProfileInfoPath() {
  const jargonTerm = getPersonalityJargonTerm();
  return `${jargonTerm}/username`;
}

// Public server configuration
// This should be set in environment variables for each deployment
const publicBaseUrl = process.env.BOT_PUBLIC_BASE_URL || 'http://localhost:3000';

// Avatar configuration
const avatarConfig = {
  // Storage settings
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  downloadTimeout: 30000, // 30 seconds
};

// Function to get avatar URL for serving
function getAvatarUrl(filename) {
  // Ensure no double slashes
  return `${publicBaseUrl}/avatars/${filename}`;
}

// Function to get any public endpoint URL
function getPublicUrl(path) {
  // Ensure path starts with / and no double slashes
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${publicBaseUrl}${normalizedPath}`;
}

module.exports = {
  getApiEndpoint,
  getModelPath,
  getProfileInfoEndpoint,
  getPrivateProfileInfoPath,
  getPersonalityJargonTerm,
  botPrefix,
  botConfig,
  avatarConfig,
  publicBaseUrl,
  getAvatarUrl,
  getPublicUrl
};