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

module.exports = {
  getApiEndpoint,
  getModelPath,
  botPrefix: process.env.PREFIX || '!tz'
};