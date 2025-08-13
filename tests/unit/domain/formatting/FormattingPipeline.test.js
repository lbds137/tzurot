/**
 * Tests for FormattingPipeline
 */

const { FormattingPipeline, MessageContent, FormattingStep } = require('../../../../src/domain/formatting');

// Create a simple test step
class TestStep extends FormattingStep {
  constructor(name, transformer) {
    super();
    this.name = name;
    this.transformer = transformer;
  }
  
  execute(content, context) {
    return this.transformer(content, context);
  }
  
  getName() {
    return this.name;
  }
}

describe('FormattingPipeline', () => {
  let pipeline;
  
  beforeEach(() => {
    pipeline = new FormattingPipeline();
  });
  
  describe('Step Management', () => {
    test('should add steps to pipeline', () => {
      const step1 = new TestStep('Step1', c => c);
      const step2 = new TestStep('Step2', c => c);
      
      pipeline.addStep(step1);
      pipeline.addStep(step2);
      
      expect(pipeline.getStepNames()).toEqual(['Step1', 'Step2']);
    });
    
    test('should remove steps by name', () => {
      const step1 = new TestStep('Step1', c => c);
      const step2 = new TestStep('Step2', c => c);
      
      pipeline.addStep(step1).addStep(step2);
      pipeline.removeStep('Step1');
      
      expect(pipeline.getStepNames()).toEqual(['Step2']);
    });
    
    test('should clear all steps', () => {
      const step1 = new TestStep('Step1', c => c);
      const step2 = new TestStep('Step2', c => c);
      
      pipeline.addStep(step1).addStep(step2);
      pipeline.clearSteps();
      
      expect(pipeline.getStepNames()).toEqual([]);
    });
    
    test('should throw error when adding non-FormattingStep', () => {
      expect(() => {
        pipeline.addStep({ execute: () => {} });
      }).toThrow('Step must be an instance of FormattingStep');
    });
  });
  
  describe('Pipeline Execution', () => {
    test('should execute steps in order', () => {
      const step1 = new TestStep('AddPrefix', c => 'prefix-' + c);
      const step2 = new TestStep('AddSuffix', c => c + '-suffix');
      
      pipeline.addStep(step1).addStep(step2);
      
      const result = pipeline.execute('content');
      
      expect(result.getValue()).toBe('prefix-content-suffix');
    });
    
    test('should handle empty content', () => {
      const step = new TestStep('Test', c => c.toUpperCase());
      pipeline.addStep(step);
      
      const result = pipeline.execute('');
      
      expect(result.getValue()).toBe('');
    });
    
    test('should handle null content', () => {
      const step = new TestStep('Test', c => c || 'default');
      pipeline.addStep(step);
      
      const result = pipeline.execute(null);
      
      expect(result.getValue()).toBe('default');
    });
    
    test('should pass context to steps', () => {
      const contextStep = new TestStep('ContextStep', (content, context) => {
        return content + (context.suffix || '');
      });
      
      pipeline.addStep(contextStep);
      
      const result = pipeline.execute('hello', { suffix: ' world' });
      
      expect(result.getValue()).toBe('hello world');
    });
    
    test('should skip steps when shouldExecute returns false', () => {
      const conditionalStep = new TestStep('Conditional', c => c + '-modified');
      conditionalStep.shouldExecute = (context) => context.enable === true;
      
      pipeline.addStep(conditionalStep);
      
      const result1 = pipeline.execute('content', { enable: false });
      expect(result1.getValue()).toBe('content');
      
      const result2 = pipeline.execute('content', { enable: true });
      expect(result2.getValue()).toBe('content-modified');
    });
    
    test('should continue on step error', () => {
      const errorStep = new TestStep('Error', () => {
        throw new Error('Step failed');
      });
      const normalStep = new TestStep('Normal', c => c + '-processed');
      
      pipeline.addStep(errorStep).addStep(normalStep);
      
      const result = pipeline.execute('content');
      
      expect(result.getValue()).toBe('content-processed');
    });
  });
  
  describe('Split Functionality', () => {
    test('should split long content', () => {
      const longContent = 'a'.repeat(2500);
      
      const chunks = pipeline.executeAndSplit(longContent, {}, 2000);
      
      expect(chunks).toHaveLength(2);
      expect(chunks[0].getValue()).toHaveLength(2000);
      expect(chunks[1].getValue()).toHaveLength(500);
    });
    
    test('should not split short content', () => {
      const shortContent = 'This is short content';
      
      const chunks = pipeline.executeAndSplit(shortContent, {}, 2000);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].getValue()).toBe('This is short content');
    });
  });
  
  describe('Pipeline Cloning', () => {
    test('should create a copy of the pipeline', () => {
      const step1 = new TestStep('Step1', c => c);
      const step2 = new TestStep('Step2', c => c);
      
      pipeline.addStep(step1).addStep(step2);
      
      const cloned = pipeline.clone();
      
      expect(cloned.getStepNames()).toEqual(['Step1', 'Step2']);
      expect(cloned).not.toBe(pipeline);
      
      // Modifying clone should not affect original
      cloned.removeStep('Step1');
      expect(pipeline.getStepNames()).toEqual(['Step1', 'Step2']);
      expect(cloned.getStepNames()).toEqual(['Step2']);
    });
  });
  
  describe('Static Factory', () => {
    test('should create pipeline from config', () => {
      const step1 = new TestStep('Step1', c => c);
      const step2 = new TestStep('Step2', c => c);
      
      const pipeline = FormattingPipeline.fromConfig({
        steps: [step1, step2],
        options: { debug: true }
      });
      
      expect(pipeline.getStepNames()).toEqual(['Step1', 'Step2']);
      expect(pipeline.debug).toBe(true);
    });
  });
});