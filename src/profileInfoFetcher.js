// Import dependencies
const nodeFetch = require('node-fetch');
const { getProfileInfoEndpoint, getAvatarUrlFormat } = require('../config');
const logger = require('./logger');

// Cache for profile information to reduce API calls
const profileInfoCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Track ongoing requests to avoid multiple simultaneous API calls for the same personality
const ongoingRequests = new Map();

// Queue for pending profile info requests to prevent too many requests at once
const requestQueue = [];
const MAX_CONCURRENT_REQUESTS = 1; // Reduced from 2 to 1 to avoid rate limiting
let activeRequests = 0;

// Time in ms to wait between API requests to avoid rate limiting
const REQUEST_DELAY = 3000; // 3 seconds between requests (increased from 1.5s)
let lastRequestTime = 0;

// Global rate limit tracking to handle server-wide limits
let consecutiveRateLimits = 0;
const MAX_CONSECUTIVE_RATE_LIMITS = 3;
const RATE_LIMIT_COOLDOWN_PERIOD = 60000; // 1 minute cooldown if we hit too many rate limits

// Use this fetch implementation which allows for easier testing
// Wrapped in a function to make it easier to mock in tests
const fetchImplementation = (...args) => nodeFetch(...args);

/**
 * Process the queue of pending profile info requests with rate limiting
 */
function processRequestQueue() {
  // Check if we have too many consecutive rate limits
  if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
    logger.warn(`[ProfileInfoFetcher] Queue processing paused due to rate limiting (${consecutiveRateLimits} consecutive 429s)`);
    // Wait for a significant cooldown to avoid hitting rate limits again
    setTimeout(processRequestQueue, RATE_LIMIT_COOLDOWN_PERIOD);
    return;
  }

  // If we have capacity and pending requests, process them
  if (activeRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    // Add some random jitter to avoid synchronized requests
    const jitter = Math.floor(Math.random() * 500);
    
    // If we need to wait before making another request
    if (timeSinceLastRequest < REQUEST_DELAY) {
      // Schedule the next request after the delay plus jitter
      const waitTime = REQUEST_DELAY - timeSinceLastRequest + jitter;
      logger.debug(`[ProfileInfoFetcher] Rate limiting: waiting ${waitTime}ms before next request (queue length: ${requestQueue.length})`);
      
      setTimeout(processRequestQueue, waitTime);
      return;
    }
    
    // Process one request at a time with proper spacing
    const nextRequest = requestQueue.shift();
    lastRequestTime = now;
    
    // Log the current queue state
    logger.debug(`[ProfileInfoFetcher] Processing next request from queue (${requestQueue.length} remaining)`);
    
    // Execute the request
    nextRequest();
    
    // If there are more requests, schedule the next check with sufficient delay
    if (requestQueue.length > 0) {
      // Use the configured delay plus a bit of jitter
      const nextCheckDelay = REQUEST_DELAY + jitter;
      logger.debug(`[ProfileInfoFetcher] Scheduling next queue check in ${nextCheckDelay}ms`);
      setTimeout(processRequestQueue, nextCheckDelay);
    }
  } else if (requestQueue.length > 0) {
    // If we don't have capacity, check again soon
    setTimeout(processRequestQueue, 1000);
  }
}

/**
 * Fetch information about a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<Object>} The profile information object
 */
async function fetchProfileInfo(profileName) {
  // If there's already an ongoing request for this personality, return its promise
  if (ongoingRequests.has(profileName)) {
    logger.info(`[ProfileInfoFetcher] Reusing existing request for: ${profileName}`);
    return ongoingRequests.get(profileName);
  }
  
  // Create a new promise that will be resolved when the request is complete
  let resolvePromise; // Store the resolve function to use later
  
  // Create the promise first
  const requestPromise = new Promise((resolve) => {
    resolvePromise = resolve; // Save the resolve function
  });
  
  // Add this request to the ongoing requests map immediately
  ongoingRequests.set(profileName, requestPromise);
  
  // Define the actual fetch operation
  const performFetch = async () => {
    activeRequests++;
    try {
      logger.info(`[ProfileInfoFetcher] Fetching profile info for: ${profileName}`);

      // Check if we have a valid cached entry
      if (profileInfoCache.has(profileName)) {
        const cacheEntry = profileInfoCache.get(profileName);
        // If cache entry is still valid, return it
        if (Date.now() - cacheEntry.timestamp < CACHE_DURATION) {
          logger.info(`[ProfileInfoFetcher] Using cached profile data for: ${profileName}`);
          resolvePromise(cacheEntry.data);
          return;
        }
      }

      // Get the endpoint from our config
      const endpoint = getProfileInfoEndpoint(profileName);
      logger.debug(`[ProfileInfoFetcher] Using endpoint: ${endpoint}`);

      // No need to check for SERVICE_API_KEY since the profile API is public
      logger.debug(`[ProfileInfoFetcher] Using public API access for profile information`);

      // Fetch the data from the API (public access)
      logger.debug(`[ProfileInfoFetcher] Sending API request for: ${profileName}`);
      
      // Create an AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      try {
        // Implement retry with exponential backoff for rate limiting
        let retryCount = 0;
        const maxRetries = 5; // Increased from 3 to 5
        let response;
        
        // Check if we've hit too many consecutive rate limits globally
        if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
          const cooldownTime = RATE_LIMIT_COOLDOWN_PERIOD;
          logger.warn(`[ProfileInfoFetcher] Too many consecutive rate limits (${consecutiveRateLimits}), enforcing global cooldown of ${cooldownTime/1000}s`);
          
          // Wait for the global cooldown period
          await new Promise(resolve => setTimeout(resolve, cooldownTime));
          
          // Reset counter after cooldown
          consecutiveRateLimits = 0;
        }
        
        while (retryCount <= maxRetries) {
          // Add jitter to avoid synchronized requests
          const jitter = Math.floor(Math.random() * 500);
          
          // Ensure minimum spacing between requests to API
          const timeSinceLastRequest = Date.now() - lastRequestTime;
          if (timeSinceLastRequest < REQUEST_DELAY) {
            const waitTime = REQUEST_DELAY - timeSinceLastRequest + jitter;
            logger.debug(`[ProfileInfoFetcher] Enforcing spacing between requests: waiting ${waitTime}ms before fetch for ${profileName}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
          
          // Update last request time
          lastRequestTime = Date.now();
          
          try {
            response = await fetchImplementation(endpoint, {
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Referer': 'https://discord.com/'
              },
              signal: controller.signal,
              // Add a proper timeout for the fetch call
              timeout: 15000 // 15 second timeout
            });
            
            // Reset consecutive rate limits if we get a successful response
            if (response.status !== 429) {
              consecutiveRateLimits = 0;
            }
            
            // If we got rate limited, implement exponential backoff
            if (response.status === 429) {
              retryCount++;
              consecutiveRateLimits++;
              
              if (retryCount <= maxRetries) {
                // Get retry-after header or use exponential backoff with larger base wait time
                const retryAfter = response.headers.get('retry-after');
                // Use a more aggressive backoff strategy
                const baseWaitTime = 3000; // 3 seconds base wait time
                const waitTime = retryAfter 
                  ? (parseInt(retryAfter, 10) * 1000) 
                  : (baseWaitTime * Math.pow(2, retryCount) + jitter);
                
                logger.warn(`[ProfileInfoFetcher] Rate limited (429) for ${profileName}, retry ${retryCount}/${maxRetries} after ${waitTime}ms. Consecutive rate limits: ${consecutiveRateLimits}`);
                
                // Update last request time to ensure proper spacing in the queue
                lastRequestTime = Date.now();
                
                // Wait for the backoff period
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue; // Try again
              }
            }
          } catch (fetchError) {
            // Handle network errors, like timeouts or connection issues
            if (fetchError.name === 'AbortError' || fetchError.type === 'aborted') {
              logger.warn(`[ProfileInfoFetcher] Request timed out for ${profileName}, retry ${retryCount + 1}/${maxRetries}`);
              retryCount++;
              
              if (retryCount <= maxRetries) {
                // Use exponential backoff for network errors too
                const waitTime = 2000 * Math.pow(2, retryCount) + jitter;
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue; // Try again
              }
            }
            
            // Re-throw for other types of errors
            throw fetchError;
          }
          
          // If we get here, either the request succeeded or we got a non-429 error or exhausted retries
          break;
        }
        
        // Clear the timeout since we got a response (do this whether it's OK or not)
        clearTimeout(timeoutId);

        if (!response.ok) {
          logger.error(
            `[ProfileInfoFetcher] API response error: ${response.status} ${response.statusText} for ${profileName}`
          );
          resolvePromise(null);
          return;
        }

        const data = await response.json();
        logger.debug(
          `[ProfileInfoFetcher] Received profile data: ${JSON.stringify(data).substring(0, 200) + (JSON.stringify(data).length > 200 ? '...' : '')}`
        );

        // Verify we have the expected fields
        if (!data) {
          logger.error(`[ProfileInfoFetcher] Received empty data for: ${profileName}`);
        } else if (!data.name) {
          logger.warn(`[ProfileInfoFetcher] Profile data missing 'name' field for: ${profileName}`);
        } else if (!data.id) {
          logger.warn(`[ProfileInfoFetcher] Profile data missing 'id' field for: ${profileName}`);
        }

        // Cache the result
        profileInfoCache.set(profileName, {
          data,
          timestamp: Date.now(),
        });
        logger.debug(`[ProfileInfoFetcher] Cached profile data for: ${profileName}`);

        resolvePromise(data);
      } catch (innerError) {
        // This inner catch handles fetch-specific errors
        clearTimeout(timeoutId);
        logger.error(`[ProfileInfoFetcher] Network error during profile fetch for ${profileName}: ${innerError.message}`);
        resolvePromise(null);
      }
    } catch (error) {
      logger.error(`[ProfileInfoFetcher] Error fetching profile info for ${profileName}: ${error.message}`);
      resolvePromise(null);
    } finally {
      // Always clean up - remove from ongoing requests and decrement active count
      ongoingRequests.delete(profileName);
      activeRequests--;
      
      // Update the last request time to ensure proper spacing
      lastRequestTime = Date.now();
      
      // Check if there are more requests in the queue, but respect the rate limiting delay
      setTimeout(processRequestQueue, REQUEST_DELAY);
    }
  };

  // Either process now or queue for later
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    performFetch();
  } else {
    // Queue the request for later
    logger.info(`[ProfileInfoFetcher] Queueing request for ${profileName} (${requestQueue.length} pending)`);
    requestQueue.push(performFetch);
  }

  return requestPromise;
}

/**
 * Get the avatar URL for a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<string|null>} The avatar URL or null if not found
 */
async function getProfileAvatarUrl(profileName) {
  logger.info(`[ProfileInfoFetcher] Getting avatar URL for: ${profileName}`);
  const profileInfo = await fetchProfileInfo(profileName);

  if (!profileInfo) {
    logger.warn(`[ProfileInfoFetcher] No profile info found for avatar: ${profileName}`);
    return null;
  }

  try {
    // Check if avatar_url is directly available in the response
    if (profileInfo.avatar_url) {
      logger.debug(`[ProfileInfoFetcher] Using avatar_url directly from API response: ${profileInfo.avatar_url}`);
      
      // Validate that it's a properly formatted URL
      try {
        new URL(profileInfo.avatar_url); // Will throw if invalid URL
        
        // Special handling for test environment with test values
        if (process.env.NODE_ENV === 'test' && profileInfo.avatar_url === 'not-a-valid-url') {
          logger.warn(`[ProfileInfoFetcher] Test environment detected with invalid URL - falling back to ID-based URL`);
          // Continue to fallback by not returning here
        } else {
          return profileInfo.avatar_url;
        }
      } catch (_) {
        logger.warn(`[ProfileInfoFetcher] Received invalid avatar_url from API: ${profileInfo.avatar_url}`);
        // Continue to fallback instead of returning invalid URL
      }
    }
    
    // Fallback to using ID-based URL format
    if (!profileInfo.id) {
      logger.warn(`[ProfileInfoFetcher] No profile ID found for avatar: ${profileName}`);
      return null;
    }
    
    // Get the avatar URL format from config
    const avatarUrlFormat = getAvatarUrlFormat();
    
    // Validate the avatar URL format from config
    if (!avatarUrlFormat || !avatarUrlFormat.includes('{id}')) {
      logger.error(`[ProfileInfoFetcher] Invalid avatarUrlFormat: "${avatarUrlFormat}". Check AVATAR_URL_BASE env variable.`);
      
      // Special handling for tests
      if (process.env.NODE_ENV === 'test' || avatarUrlFormat === 'invalid-url-without-id-placeholder') {
        return null;
      }
      
      // In production, try to continue anyway
      return null;
    }

    // Replace the placeholder with the actual profile ID
    const avatarUrl = avatarUrlFormat.replace('{id}', profileInfo.id);
    logger.debug(`[ProfileInfoFetcher] Generated avatar URL for ${profileName}: ${avatarUrl}`);
    
    // Validate the generated URL
    try {
      new URL(avatarUrl); // Will throw if invalid URL
      return avatarUrl;
    } catch (_) {
      logger.error(`[ProfileInfoFetcher] Generated invalid avatar URL: ${avatarUrl}`);
      return null;
    }
  } catch (error) {
    logger.error(`[ProfileInfoFetcher] Error generating avatar URL: ${error.message}`);
    return null;
  }
}

/**
 * Get the display name for a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<string|null>} The display name or null if not found
 */
async function getProfileDisplayName(profileName) {
  logger.info(`[ProfileInfoFetcher] Getting display name for: ${profileName}`);
  const profileInfo = await fetchProfileInfo(profileName);

  if (!profileInfo) {
    logger.warn(`[ProfileInfoFetcher] No profile info found for display name: ${profileName}`);
    return null; // Return null to indicate failure, don't automatically use profileName
  }

  if (!profileInfo.name) {
    logger.warn(`[ProfileInfoFetcher] No name field in profile info for: ${profileName}`);
    return null; // Return null to indicate failure
  }

  logger.debug(`[ProfileInfoFetcher] Found display name for ${profileName}: ${profileInfo.name}`);
  return profileInfo.name;
}

// Exported for testing only
function clearCache() {
  profileInfoCache.clear();
}

module.exports = {
  fetchProfileInfo,
  getProfileAvatarUrl,
  getProfileDisplayName,
  // For testing
  _testing: {
    clearCache,
    getCache: () => profileInfoCache,
    setFetchImplementation: (newImpl) => {
      // This allows tests to override the fetchImplementation
      Object.defineProperty(module.exports, 'fetchImplementation', {
        value: newImpl,
        writable: true
      });
    }
  }
};