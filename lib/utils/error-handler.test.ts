import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getErrorMessage, getSanitizedErrorDetail } from './error-handler';

describe('error-handler.ts', () => {
  describe('getErrorMessage', () => {
    it('should return error message for Error instance', () => {
      const error = new Error('Test error message');
      expect(getErrorMessage(error)).toBe('Test error message');
    });

    it('should add status code prefix when available', () => {
      const error = new Error('Not found') as Error & { statusCode?: number };
      error.statusCode = 404;
      expect(getErrorMessage(error)).toBe('[404] Not found');
    });

    it('should extract message from responseBody JSON', () => {
      const error = new Error('API error') as Error & { responseBody?: string };
      error.responseBody = JSON.stringify({ message: 'Detailed error message' });
      expect(getErrorMessage(error)).toContain('Detailed error message');
    });

    it('should extract message from responseBody SSE format', () => {
      const error = new Error('API error') as Error & { responseBody?: string; statusCode?: number };
      error.responseBody = 'data:{"error":{"message":"SSE error message"}}';
      error.statusCode = 400;
      expect(getErrorMessage(error)).toContain('SSE error message');
    });

    it('should return string error as-is', () => {
      expect(getErrorMessage('Simple string error')).toBe('Simple string error');
    });

    it('should return default message for unknown error types', () => {
      expect(getErrorMessage(12345)).toBe('未知错误');
      expect(getErrorMessage(null)).toBe('未知错误');
      expect(getErrorMessage(undefined)).toBe('未知错误');
    });

    it('should handle Error with no responseBody', () => {
      const error = new Error('Basic error');
      expect(getErrorMessage(error)).toBe('Basic error');
    });

    it('should truncate long responseBody to 100 chars', () => {
      const error = new Error('API error') as Error & { responseBody?: string };
      error.responseBody = 'a'.repeat(200);
      const message = getErrorMessage(error);
      // Should contain the truncated version
      expect(message.length).toBeLessThan(200);
    });
  });

  describe('getSanitizedErrorDetail', () => {
    it('should sanitize string errors', () => {
      expect(getSanitizedErrorDetail('simple error')).toBe('simple error');
    });

    it('should return string "null" for null input', () => {
      expect(getSanitizedErrorDetail(null)).toBe('null');
    });

    it('should return undefined for undefined input', () => {
      expect(getSanitizedErrorDetail(undefined)).toBeUndefined();
    });

    it('should sanitize Error objects', () => {
      const error = new Error('Test error');
      const result = getSanitizedErrorDetail(error);
      expect(result).toContain('Test error');
    });

    it('should sanitize sensitive fields in objects', () => {
      const error = {
        message: 'Error',
        apiKey: 'sk-very-secret-api-key-12345',
        token: 'long-secret-token-value-here',
      };
      const result = getSanitizedErrorDetail(error);
      expect(result).not.toContain('sk-very-secret-api-key-12345');
      expect(result).not.toContain('long-secret-token-value-here');
    });

    it('should sanitize arrays', () => {
      const errors = [new Error('error1'), new Error('error2')];
      const result = getSanitizedErrorDetail(errors);
      expect(result).toContain('error1');
      expect(result).toContain('error2');
    });

    it('should handle objects with nested sensitive data', () => {
      const error = {
        config: {
          authorization: 'Bearer secret-token',
          api_key: 'sk-secret-key-value',
        },
      };
      const result = getSanitizedErrorDetail(error);
      expect(result).not.toContain('secret-token');
      expect(result).not.toContain('sk-secret-key-value');
    });

    it('should preserve non-sensitive fields', () => {
      const error = {
        message: 'Error occurred',
        code: 500,
        url: 'https://api.example.com',
      };
      const result = getSanitizedErrorDetail(error);
      expect(result).toContain('Error occurred');
      expect(result).toContain('500');
    });
  });
});
