import { describe, expect, it } from 'vitest';
import { OriginValidationError, validatePanelOrigin } from './origin-validation';

describe('validatePanelOrigin', () => {
  it('accepts a canonical HTTPS origin', () => {
    expect(validatePanelOrigin('https://panel.example.com', false)).toBe('https://panel.example.com');
  });

  it('normalizes a trailing slash', () => {
    expect(validatePanelOrigin('https://panel.example.com/', false)).toBe('https://panel.example.com');
  });

  it.each([
    ['https://panel.example.com/servers', 'paths'],
    ['https://panel.example.com/?source=home', 'queries'],
    ['https://panel.example.com/#panel', 'fragments'],
    ['https://operator:secret@panel.example.com', 'credentials'],
    ['http://panel.example.com', 'insecure HTTP'],
    ['not a URL', 'malformed URLs'],
  ])('rejects %s with %s', (origin) => {
    expect(() => validatePanelOrigin(origin, false)).toThrow(OriginValidationError);
  });

  it('rejects local and IP targets in production', () => {
    expect(() => validatePanelOrigin('https://localhost', false)).toThrow(OriginValidationError);
    expect(() => validatePanelOrigin('https://server.local', false)).toThrow(OriginValidationError);
    expect(() => validatePanelOrigin('https://localhost.', false)).toThrow(OriginValidationError);
    expect(() => validatePanelOrigin('https://panel.local.', false)).toThrow(OriginValidationError);
    expect(() => validatePanelOrigin('https://192.168.1.10', false)).toThrow(OriginValidationError);
    expect(() => validatePanelOrigin('https://[::1]', false)).toThrow(OriginValidationError);
  });

  it('permits exact localhost only when explicitly development-gated', () => {
    expect(validatePanelOrigin('http://localhost:5173', true)).toBe('http://localhost:5173');
    expect(() => validatePanelOrigin('http://127.0.0.1:5173', true)).toThrow(OriginValidationError);
  });
});
