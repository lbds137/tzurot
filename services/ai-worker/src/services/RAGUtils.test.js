"use strict";
/**
 * Tests for RAG Utility Functions
 */
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var common_types_1 = require("@tzurot/common-types");
var RAGUtils_js_1 = require("./RAGUtils.js");
(0, vitest_1.describe)('RAGUtils', function () {
    (0, vitest_1.describe)('buildAttachmentDescriptions', function () {
        (0, vitest_1.it)('should return undefined for empty attachments', function () {
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)([]);
            (0, vitest_1.expect)(result).toBeUndefined();
        });
        (0, vitest_1.it)('should format image attachment with name', function () {
            var attachments = [
                {
                    type: common_types_1.AttachmentType.Image,
                    description: 'A beautiful sunset over mountains',
                    metadata: { name: 'sunset.jpg' },
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            (0, vitest_1.expect)(result).toBe('[Image: sunset.jpg]\nA beautiful sunset over mountains');
        });
        (0, vitest_1.it)('should format image attachment without name', function () {
            var attachments = [
                {
                    type: common_types_1.AttachmentType.Image,
                    description: 'An abstract pattern',
                    metadata: {},
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            (0, vitest_1.expect)(result).toBe('[Image: attachment]\nAn abstract pattern');
        });
        (0, vitest_1.it)('should format image attachment with empty name', function () {
            var attachments = [
                {
                    type: common_types_1.AttachmentType.Image,
                    description: 'Some image',
                    metadata: { name: '' },
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            (0, vitest_1.expect)(result).toBe('[Image: attachment]\nSome image');
        });
        (0, vitest_1.it)('should format voice message with duration', function () {
            var attachments = [
                {
                    type: common_types_1.AttachmentType.Audio,
                    description: 'User said hello and asked about the weather',
                    metadata: { isVoiceMessage: true, duration: 5.5 },
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            (0, vitest_1.expect)(result).toBe('[Voice message: 5.5s]\nUser said hello and asked about the weather');
        });
        (0, vitest_1.it)('should format audio attachment with name', function () {
            var attachments = [
                {
                    type: common_types_1.AttachmentType.Audio,
                    description: 'A podcast episode about AI',
                    metadata: { name: 'podcast.mp3', isVoiceMessage: false },
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            (0, vitest_1.expect)(result).toBe('[Audio: podcast.mp3]\nA podcast episode about AI');
        });
        (0, vitest_1.it)('should format audio attachment without name', function () {
            var attachments = [
                {
                    type: common_types_1.AttachmentType.Audio,
                    description: 'Some audio content',
                    metadata: {},
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            (0, vitest_1.expect)(result).toBe('[Audio: attachment]\nSome audio content');
        });
        (0, vitest_1.it)('should format voice message with zero duration as audio', function () {
            var attachments = [
                {
                    type: common_types_1.AttachmentType.Audio,
                    description: 'Voice content',
                    metadata: { isVoiceMessage: true, duration: 0, name: 'voice.ogg' },
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            (0, vitest_1.expect)(result).toBe('[Audio: voice.ogg]\nVoice content');
        });
        (0, vitest_1.it)('should format voice message with null duration as audio', function () {
            var attachments = [
                {
                    type: common_types_1.AttachmentType.Audio,
                    description: 'Voice content',
                    metadata: {
                        isVoiceMessage: true,
                        duration: null,
                        name: 'voice.ogg',
                    },
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            (0, vitest_1.expect)(result).toBe('[Audio: voice.ogg]\nVoice content');
        });
        (0, vitest_1.it)('should format multiple attachments separated by double newlines', function () {
            var attachments = [
                {
                    type: common_types_1.AttachmentType.Image,
                    description: 'First image',
                    metadata: { name: 'first.png' },
                },
                {
                    type: common_types_1.AttachmentType.Audio,
                    description: 'Second audio',
                    metadata: { isVoiceMessage: true, duration: 3.2 },
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            (0, vitest_1.expect)(result).toBe('[Image: first.png]\nFirst image\n\n[Voice message: 3.2s]\nSecond audio');
        });
        (0, vitest_1.it)('should handle attachments with unknown type', function () {
            var attachments = [
                {
                    type: 'unknown',
                    description: 'Some unknown content',
                    metadata: {},
                },
            ];
            var result = (0, RAGUtils_js_1.buildAttachmentDescriptions)(attachments);
            // Unknown types get no header, just description
            (0, vitest_1.expect)(result).toBe('\nSome unknown content');
        });
    });
    (0, vitest_1.describe)('generateStopSequences', function () {
        (0, vitest_1.it)('should generate stop sequence for personality name', function () {
            var participantPersonas = new Map();
            var result = (0, RAGUtils_js_1.generateStopSequences)('Lilith', participantPersonas);
            (0, vitest_1.expect)(result).toContain('\nLilith:');
        });
        (0, vitest_1.it)('should generate stop sequences for all participants', function () {
            var participantPersonas = new Map([
                ['Alice', { content: 'User persona', isActive: true }],
                ['Bob', { content: 'Another user', isActive: false }],
            ]);
            var result = (0, RAGUtils_js_1.generateStopSequences)('Lilith', participantPersonas);
            (0, vitest_1.expect)(result).toContain('\nAlice:');
            (0, vitest_1.expect)(result).toContain('\nBob:');
            (0, vitest_1.expect)(result).toContain('\nLilith:');
        });
        (0, vitest_1.it)('should include XML tag stop sequences', function () {
            var participantPersonas = new Map();
            var result = (0, RAGUtils_js_1.generateStopSequences)('Lilith', participantPersonas);
            (0, vitest_1.expect)(result).toContain('<message ');
            (0, vitest_1.expect)(result).toContain('<message>');
            (0, vitest_1.expect)(result).toContain('</message>');
            (0, vitest_1.expect)(result).toContain('<chat_log>');
            (0, vitest_1.expect)(result).toContain('</chat_log>');
            (0, vitest_1.expect)(result).toContain('<quoted_messages>');
            (0, vitest_1.expect)(result).toContain('</quoted_messages>');
            (0, vitest_1.expect)(result).toContain('<quote ');
            (0, vitest_1.expect)(result).toContain('<quote>');
            (0, vitest_1.expect)(result).toContain('</quote>');
        });
        (0, vitest_1.it)('should return correct total count of stop sequences', function () {
            var participantPersonas = new Map([
                ['Alice', { content: 'User persona', isActive: true }],
            ]);
            var result = (0, RAGUtils_js_1.generateStopSequences)('Lilith', participantPersonas);
            // 1 participant + 1 personality + 10 XML tags = 12
            (0, vitest_1.expect)(result.length).toBe(12);
        });
        (0, vitest_1.it)('should handle empty participant map', function () {
            var participantPersonas = new Map();
            var result = (0, RAGUtils_js_1.generateStopSequences)('TestBot', participantPersonas);
            // Should still have personality name and XML sequences
            (0, vitest_1.expect)(result).toContain('\nTestBot:');
            (0, vitest_1.expect)(result.length).toBe(11); // 1 personality + 10 XML tags
        });
        (0, vitest_1.it)('should cap stop sequences at 16 (Google API limit)', function () {
            // Create many participants to exceed the limit
            // Max is 16, with 10 XML + 1 personality = 11 reserved, leaving 5 for participants
            var participantPersonas = new Map([
                ['User1', { content: '', isActive: true }],
                ['User2', { content: '', isActive: true }],
                ['User3', { content: '', isActive: true }],
                ['User4', { content: '', isActive: true }],
                ['User5', { content: '', isActive: true }],
                ['User6', { content: '', isActive: true }], // Should be truncated
                ['User7', { content: '', isActive: true }], // Should be truncated
                ['User8', { content: '', isActive: true }], // Should be truncated
            ]);
            var result = (0, RAGUtils_js_1.generateStopSequences)('Lilith', participantPersonas);
            // Should be exactly 16 (the max allowed)
            (0, vitest_1.expect)(result.length).toBe(16);
            // XML sequences should always be present
            (0, vitest_1.expect)(result).toContain('<message ');
            (0, vitest_1.expect)(result).toContain('</chat_log>');
            // Personality should always be present
            (0, vitest_1.expect)(result).toContain('\nLilith:');
            // First 5 participants should be present
            (0, vitest_1.expect)(result).toContain('\nUser1:');
            (0, vitest_1.expect)(result).toContain('\nUser5:');
            // User6+ should be truncated
            (0, vitest_1.expect)(result).not.toContain('\nUser6:');
            (0, vitest_1.expect)(result).not.toContain('\nUser7:');
            (0, vitest_1.expect)(result).not.toContain('\nUser8:');
        });
        (0, vitest_1.it)('should not truncate when under the limit', function () {
            var participantPersonas = new Map([
                ['User1', { content: '', isActive: true }],
                ['User2', { content: '', isActive: true }],
                ['User3', { content: '', isActive: true }],
            ]);
            var result = (0, RAGUtils_js_1.generateStopSequences)('Lilith', participantPersonas);
            // 3 participants + 1 personality + 10 XML = 14 (under limit)
            (0, vitest_1.expect)(result.length).toBe(14);
            (0, vitest_1.expect)(result).toContain('\nUser1:');
            (0, vitest_1.expect)(result).toContain('\nUser2:');
            (0, vitest_1.expect)(result).toContain('\nUser3:');
        });
    });
});
