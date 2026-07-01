import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db module
vi.mock('./db', () => ({
  updateActiveModel: vi.fn(),
}));

// Mock challenge module
vi.mock('./challenge', () => ({
  generateChallenge: vi.fn(() => ({
    prompt: 'Say hello',
    expectedAnswer: 'hello',
    difficulty: 1,
  })),
  validateResponse: vi.fn(() => ({
    valid: true,
    normalized: 'hello',
  })),
}));

import { runApiChecks, type ApiCheckResult } from './checker';

describe('checker.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runApiChecks', () => {
    it('should return empty array for empty configs', async () => {
      const result = await runApiChecks([]);
      expect(result).toEqual([]);
    });

    it('should handle network errors gracefully', async () => {
      // Mock fetch to fail
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const configs: any[] = [{
        id: 1,
        name: 'test',
        type: 'openai',
        base_url: 'https://api.openai.com/v1/chat/completions',
        api_key: 'sk-test',
        model: 'gpt-4',
        enabled: true,
      }];

      const result = await runApiChecks(configs);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('error');
      expect(result[0].message).toContain('Network error');
    });

    it('should handle HTTP errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        JSON.stringify({ error: { message: 'Invalid API key' } }),
        { status: 401 }
      ));

      const configs: any[] = [{
        id: 1,
        name: 'test',
        type: 'openai',
        base_url: 'https://api.openai.com/v1/chat/completions',
        api_key: 'sk-invalid',
        model: 'gpt-4',
        enabled: true,
      }];

      const result = await runApiChecks(configs);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('error');
      expect(result[0].message).toContain('Invalid API key');
    });

    it('should sort results by name', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('test'));

      const configs: any[] = [
        { id: 1, name: 'Zebra', type: 'openai', base_url: 'https://a.com', api_key: 'k', model: 'm', enabled: true },
        { id: 2, name: 'Apple', type: 'openai', base_url: 'https://b.com', api_key: 'k', model: 'm', enabled: true },
      ];

      const result = await runApiChecks(configs);

      expect(result[0].name).toBe('Apple');
      expect(result[1].name).toBe('Zebra');
    });
  });
});
