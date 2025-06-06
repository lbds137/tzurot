// Load environment variables
require('dotenv').config();

// Environment detection
// eslint-disable-next-line no-restricted-syntax -- Config file needs to check environment
const isDevelopment = process.env.NODE_ENV === 'development';

// Environment-based bot configuration
const botConfig = {
  // Bot identification
  name: isDevelopment ? 'Rotzot' : 'Tzurot',
  prefix: isDevelopment ? '!rtz' : '!tz',
  mentionChar: isDevelopment ? '&' : '@',
  token: isDevelopment ? process.env.DISCORD_DEV_TOKEN : process.env.DISCORD_TOKEN,
  
  // Environment flag
  isDevelopment,
  environment: isDevelopment ? 'development' : 'production'
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

// Function to get the complete model path for a personality
function getModelPath(personalityName) {
  return `${getServiceId()}/${personalityName}`;
}

// Function to get the profile info endpoint for a personality
function getProfileInfoEndpoint(personalityName) {
  return `${process.env.PROFILE_INFO_ENDPOINT}/${personalityName}`;
}

// Public server configuration
const publicBaseUrl = process.env.BOT_PUBLIC_BASE_URL || 
  (isDevelopment ? 'http://localhost:3000' : 'https://tzurot.up.railway.app');

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
  botPrefix,
  botConfig,
  avatarConfig,
  publicBaseUrl,
  getAvatarUrl,
  getPublicUrl
};