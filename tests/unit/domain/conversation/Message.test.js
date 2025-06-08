/**
 * @jest-environment node
 */

const { Message } = require('../../../../src/domain/conversation/Message');

describe('Message', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  describe('constructor', () => {
    it('should create message with all required fields', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello, world!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: new Date(),
        isFromPersonality: true,
      });
      
      expect(message.id).toBe('msg-123');
      expect(message.content).toBe('Hello, world!');
      expect(message.authorId).toBe('123456789012345678');
      expect(message.personalityId).toBe('claude-3-opus');
      expect(message.timestamp).toEqual(new Date());
      expect(message.isFromPersonality).toBe(true);
    });
    
    it('should create user message without personalityId', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
      });
      
      expect(message.personalityId).toBeNull();
      expect(message.isFromPersonality).toBe(false);
    });
    
    it('should default isFromPersonality to false', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      });
      
      expect(message.isFromPersonality).toBe(false);
    });
  });
  
  describe('validation', () => {
    it('should require id', () => {
      expect(() => new Message({
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      })).toThrow('Message requires valid id');
      
      expect(() => new Message({
        id: '',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      })).toThrow('Message requires valid id');
      
      expect(() => new Message({
        id: null,
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      })).toThrow('Message requires valid id');
    });
    
    it('should require id to be string', () => {
      expect(() => new Message({
        id: 123,
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      })).toThrow('Message requires valid id');
    });
    
    it('should require content', () => {
      expect(() => new Message({
        id: 'msg-123',
        authorId: '123456789012345678',
        timestamp: new Date(),
      })).toThrow('Message requires content');
      
      expect(() => new Message({
        id: 'msg-123',
        content: '',
        authorId: '123456789012345678',
        timestamp: new Date(),
      })).toThrow('Message requires content');
      
      expect(() => new Message({
        id: 'msg-123',
        content: null,
        authorId: '123456789012345678',
        timestamp: new Date(),
      })).toThrow('Message requires content');
    });
    
    it('should require content to be string', () => {
      expect(() => new Message({
        id: 'msg-123',
        content: 123,
        authorId: '123456789012345678',
        timestamp: new Date(),
      })).toThrow('Message requires content');
    });
    
    it('should require authorId', () => {
      expect(() => new Message({
        id: 'msg-123',
        content: 'Hello!',
        timestamp: new Date(),
      })).toThrow('Message requires authorId');
      
      expect(() => new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '',
        timestamp: new Date(),
      })).toThrow('Message requires authorId');
      
      expect(() => new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: null,
        timestamp: new Date(),
      })).toThrow('Message requires authorId');
    });
    
    it('should require authorId to be string', () => {
      expect(() => new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: 123456789012345678,
        timestamp: new Date(),
      })).toThrow('Message requires authorId');
    });
    
    it('should require timestamp', () => {
      expect(() => new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
      })).toThrow('Message requires valid timestamp');
      
      expect(() => new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: null,
      })).toThrow('Message requires valid timestamp');
    });
    
    it('should require timestamp to be Date', () => {
      expect(() => new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: '2024-01-01',
      })).toThrow('Message requires valid timestamp');
      
      expect(() => new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: Date.now(),
      })).toThrow('Message requires valid timestamp');
    });
  });
  
  describe('isFromUser', () => {
    it('should return true for user messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
        isFromPersonality: false,
      });
      
      expect(message.isFromUser()).toBe(true);
    });
    
    it('should return false for personality messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: 'claude-3-opus',
        personalityId: 'claude-3-opus',
        timestamp: new Date(),
        isFromPersonality: true,
      });
      
      expect(message.isFromUser()).toBe(false);
    });
  });
  
  describe('getAge', () => {
    it('should return age in milliseconds', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      });
      
      // Advance time by 5 seconds
      jest.advanceTimersByTime(5000);
      
      expect(message.getAge()).toBe(5000);
    });
    
    it('should handle old messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      });
      
      // Advance time by 1 hour
      jest.advanceTimersByTime(60 * 60 * 1000);
      
      expect(message.getAge()).toBe(60 * 60 * 1000);
    });
  });
  
  describe('isExpired', () => {
    it('should return false for fresh messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      });
      
      expect(message.isExpired(60000)).toBe(false);
    });
    
    it('should return true for expired messages', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      });
      
      // Advance time beyond timeout
      jest.advanceTimersByTime(61000);
      
      expect(message.isExpired(60000)).toBe(true);
    });
    
    it('should handle exact timeout boundary', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: new Date(),
      });
      
      // Advance time to exactly timeout
      jest.advanceTimersByTime(60000);
      
      expect(message.isExpired(60000)).toBe(false);
      
      // One millisecond more
      jest.advanceTimersByTime(1);
      
      expect(message.isExpired(60000)).toBe(true);
    });
  });
  
  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const timestamp = new Date();
      const message = new Message({
        id: 'msg-123',
        content: 'Hello, world!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: timestamp,
        isFromPersonality: false,
      });
      
      const json = message.toJSON();
      
      expect(json).toEqual({
        id: 'msg-123',
        content: 'Hello, world!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: timestamp.toISOString(),
        isFromPersonality: false,
      });
    });
    
    it('should handle null personalityId', () => {
      const timestamp = new Date();
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: timestamp,
        isFromPersonality: false,
      });
      
      const json = message.toJSON();
      
      expect(json.personalityId).toBeNull();
    });
  });
  
  describe('fromJSON', () => {
    it('should deserialize from JSON', () => {
      const timestamp = new Date();
      const json = {
        id: 'msg-123',
        content: 'Hello, world!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: timestamp.toISOString(),
        isFromPersonality: false,
      };
      
      const message = Message.fromJSON(json);
      
      expect(message).toBeInstanceOf(Message);
      expect(message.id).toBe('msg-123');
      expect(message.content).toBe('Hello, world!');
      expect(message.authorId).toBe('123456789012345678');
      expect(message.personalityId).toBe('claude-3-opus');
      expect(message.timestamp).toEqual(timestamp);
      expect(message.isFromPersonality).toBe(false);
    });
    
    it('should handle timestamp string conversion', () => {
      const json = {
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        timestamp: '2024-01-01T00:00:00.000Z',
        isFromPersonality: false,
      };
      
      const message = Message.fromJSON(json);
      
      expect(message.timestamp).toBeInstanceOf(Date);
      expect(message.timestamp.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    });
  });
  
  describe('immutability', () => {
    it('should not be affected by JSON modifications', () => {
      const message = new Message({
        id: 'msg-123',
        content: 'Hello!',
        authorId: '123456789012345678',
        personalityId: 'claude-3-opus',
        timestamp: new Date(),
        isFromPersonality: false,
      });
      
      const json = message.toJSON();
      
      // Modifying JSON should not affect original
      json.content = 'Modified';
      json.authorId = 'modified-id';
      json.isFromPersonality = true;
      
      expect(message.content).toBe('Hello!');
      expect(message.authorId).toBe('123456789012345678');
      expect(message.isFromPersonality).toBe(false);
    });
  });
});