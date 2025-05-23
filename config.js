// Load environment variables
require('dotenv').config();

// Bot configuration
const botPrefix = process.env.PREFIX || '!tz';

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
  botPrefix
};