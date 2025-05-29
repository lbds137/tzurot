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

// This function has been removed as we now use avatar URLs directly from the API

module.exports = {
  getApiEndpoint,
  getModelPath,
  getProfileInfoEndpoint,
  botPrefix,
  botConfig
};