import { describe, it, expect } from 'vitest';
import { buildTestRequest, validateResponse, type TestRequestResult } from './test-utils';

describe('test-utils.ts', () => {
  describe('buildTestRequest', () => {
    describe('OpenAI type', () => {
      it('should build correct OpenAI request', () => {
        const result = buildTestRequest('openai', 'sk-test', 'https://api.openai.com/v1/chat/completions', 'gpt-4');

        expect(result.url).toBe('https://api.openai.com/v1/chat/completions');
        expect(result.headers['Authorization']).toBe('Bearer sk-test');
        expect(result.headers['Content-Type']).toBe('application/json');
        expect(result.body.model).toBe('gpt-4');
        expect(result.body.stream).toBe(false);
        expect(result.body.max_tokens).toBe(32);
        expect(Array.isArray(result.body.messages)).toBe(true);
      });

      it('should include system and user messages', () => {
        const result = buildTestRequest('openai', 'sk-test', 'https://api.openai.com', 'gpt-4');

        const messages = result.body.messages as Array<{ role: string; content: string }>;
        expect(messages).toHaveLength(2);
        expect(messages[0].role).toBe('system');
        expect(messages[1].role).toBe('user');
      });
    });

    describe('Anthropic type', () => {
      it('should build correct Anthropic request', () => {
        const result = buildTestRequest('anthropic', 'sk-ant-test', 'https://api.anthropic.com/v1/messages', 'claude-3');

        expect(result.url).toBe('https://api.anthropic.com/v1/messages');
        expect(result.headers['x-api-key']).toBe('sk-ant-test');
        expect(result.headers['anthropic-version']).toBe('2023-06-01');
        expect(result.body.model).toBe('claude-3');
        expect(result.body.stream).toBe(false);
        expect(result.body.system).toBeDefined();
        expect(Array.isArray(result.body.messages)).toBe(true);
      });
    });

    describe('Gemini type', () => {
      it('should build correct Gemini request', () => {
        const result = buildTestRequest('gemini', 'AIza-key', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro', 'gemini-pro');

        expect(result.url).toContain('key=AIza-key');
        expect(result.url).toContain('generateContent');
        expect(result.headers['Content-Type']).toBe('application/json');
        expect(result.body.contents).toBeDefined();
        expect(result.body.generationConfig).toBeDefined();
      });

      it('should add generateContent suffix if missing', () => {
        const result = buildTestRequest('gemini', 'key', 'https://api.example.com/v1/models', 'gemini-pro');

        expect(result.url).toContain(':generateContent');
      });
    });
  });

  describe('validateResponse', () => {
    describe('OpenAI format', () => {
      it('should validate valid OpenAI response', () => {
        const body = JSON.stringify({
          choices: [{ message: { content: 'hello' } }],
        });

        const result = validateResponse('openai', body);
        expect(result.valid).toBe(true);
        expect(result.content).toBe('hello');
      });

      it('should strip think tags from response', () => {
        const body = JSON.stringify({
          choices: [{ message: { content: '<think>thinking...</think>hello' } }],
        });

        const result = validateResponse('openai', body);
        expect(result.valid).toBe(true);
        expect(result.content).toBe('hello');
      });

      it('should reject response with error field', () => {
        const body = JSON.stringify({
          error: { message: 'Invalid API key' },
        });

        const result = validateResponse('openai', body);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid API key');
      });

      it('should reject empty response', () => {
        const body = JSON.stringify({
          choices: [{ message: { content: '' } }],
        });

        const result = validateResponse('openai', body);
        expect(result.valid).toBe(false);
      });

      it('should reject response without choices', () => {
        const body = JSON.stringify({ usage: { total_tokens: 10 } });

        const result = validateResponse('openai', body);
        expect(result.valid).toBe(false);
      });
    });

    describe('Anthropic format', () => {
      it('should validate valid Anthropic response', () => {
        const body = JSON.stringify({
          content: [{ text: 'hello' }],
        });

        const result = validateResponse('anthropic', body);
        expect(result.valid).toBe(true);
        expect(result.content).toBe('hello');
      });

      it('should reject response without content', () => {
        const body = JSON.stringify({ id: 'msg_123', type: 'message' });

        const result = validateResponse('anthropic', body);
        expect(result.valid).toBe(false);
      });
    });

    describe('Gemini format', () => {
      it('should validate valid Gemini response', () => {
        const body = JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'hello' }] } }],
        });

        const result = validateResponse('gemini', body);
        expect(result.valid).toBe(true);
        expect(result.content).toBe('hello');
      });

      it('should reject response without candidates', () => {
        const body = JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } });

        const result = validateResponse('gemini', body);
        expect(result.valid).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should reject empty body', () => {
        const result = validateResponse('openai', '');
        expect(result.valid).toBe(false);
      });

      it('should reject non-JSON body', () => {
        const result = validateResponse('openai', 'not json at all');
        expect(result.valid).toBe(false);
      });

      it('should reject very short body', () => {
        const result = validateResponse('openai', 'short');
        expect(result.valid).toBe(false);
      });
    });
  });
});
