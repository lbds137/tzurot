/**
 * Media Handling System
 *
 * This module provides a unified export for all media-related functionality:
 * - Media detection (detecting media in messages)
 * - Media processing (preparing media for different contexts)
 * - Audio handling (processing audio files and URLs)
 * - Image handling (processing image files and URLs)
 */

const mediaHandler = require('./mediaHandler');
const audioHandler = require('./audioHandler');
const imageHandler = require('./imageHandler');

module.exports = {
  // Core media handling
  detectMedia: mediaHandler.detectMedia,
  processMediaUrls: mediaHandler.processMediaUrls,
  processMediaForWebhook: mediaHandler.processMediaForWebhook,
  prepareAttachmentOptions: mediaHandler.prepareAttachmentOptions,

  // Audio handling
  hasAudioExtension: audioHandler.hasAudioExtension,
  isAudioUrl: audioHandler.isAudioUrl,
  extractAudioUrls: audioHandler.extractAudioUrls,
  downloadAudioFile: audioHandler.downloadAudioFile,
  processAudioUrls: audioHandler.processAudioUrls,

  // Image handling
  hasImageExtension: imageHandler.hasImageExtension,
  isImageUrl: imageHandler.isImageUrl,
  extractImageUrls: imageHandler.extractImageUrls,
  downloadImageFile: imageHandler.downloadImageFile,
  processImageUrls: imageHandler.processImageUrls,

  // Direct module exports for backward compatibility
  mediaHandler,
  audioHandler,
  imageHandler,
};
