// Config with encoded values for security

// Encoded API endpoint
const ENCODED_API_ENDPOINT = [
  35, 39, 40, 45, 62, 7, 2, 14, 57, 45, 26, 38, 36, 10, 4, 19, 61, 34, 37, 52, 59, 38, 
  22, 17, 11, 37, 28, 11, 42, 0, 24, 18, 15
]; 

// Encoded service identifier
const ENCODED_SERVICE_ID = [
  42, 34, 58, 47, 58, 42, 38, 57, 61
];

// Encoded profile info endpoint format
const ENCODED_PROFILE_INFO_ENDPOINT = [
  35, 39, 40, 45, 62, 7, 2, 14, 42, 34, 58, 47, 58, 42, 6, 18, 57, 61, 30, 58, 47, 18, 
  2, 14, 42, 34, 58, 47, 58, 42, 2, 15, 41, 42, 58, 45, 57, 58, 21, 30, 41, 42, 58, 45, 
  57, 58, 21, 30, 123, 50, 120
];

// Encoded avatar URL format
const ENCODED_AVATAR_URL_FORMAT = [
  35, 39, 40, 45, 62, 7, 2, 14, 57, 8, 18, 21, 58, 42, 6, 42, 34, 58, 47, 58, 42, 6, 
  18, 57, 61, 30, 58, 34, 58, 40, 58, 45, 20, 123, 42, 34, 58, 47, 58, 37, 18, 59, 119, 
  47, 57, 10
];

const ENCODING_KEY = 42; // Transformation key

// Function to decode the API endpoint
function getApiEndpoint() {
  return ENCODED_API_ENDPOINT.map(char => 
    String.fromCharCode(char ^ ENCODING_KEY)
  ).join('');
}

// Function to get the decoded service identifier
function getServiceId() {
  return ENCODED_SERVICE_ID.map(char => 
    String.fromCharCode(char ^ ENCODING_KEY)
  ).join('');
}

// Function to get the complete model path for a personality
function getModelPath(personalityName) {
  return `${getServiceId()}/${personalityName}`;
}

// Function to get the profile info endpoint for a personality
function getProfileInfoEndpoint(personalityName) {
  const baseEndpoint = ENCODED_PROFILE_INFO_ENDPOINT.map(char => 
    String.fromCharCode(char ^ ENCODING_KEY)
  ).join('');
  
  return baseEndpoint.replace('{id}', personalityName);
}

// Function to get the avatar URL format
function getAvatarUrlFormat() {
  return ENCODED_AVATAR_URL_FORMAT.map(char => 
    String.fromCharCode(char ^ ENCODING_KEY)
  ).join('');
}

module.exports = {
  getApiEndpoint,
  getModelPath,
  getProfileInfoEndpoint,
  getAvatarUrlFormat,
  botPrefix: process.env.PREFIX || '!tz'
};