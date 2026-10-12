import { describe, it, expect } from 'vitest';
import { parseRepoConfig, DEFAULT_EXCLUDE } from '../../src/config/schema.js';
import { loadRepoConfig } from '../../src/config/loader.js';

describe('parseRepoConfig', () => {
  it('returns defaults when given empty object', () => {
    const result = parseRepoConfig({});
    expect(result.language).toBe('zh');
    expect(result.selfCritiqueThreshold).toBe(0.6);
    expect(result.maxFilesPerReview).toBe(20);
    expect(result.rules).toEqual([]);
    expect(result.exclude).toEqual(DEFAULT_EXCLUDE);
  });

  it('merges custom rules with empty defaults', () => {
    const result = parseRepoConfig({ rules: ['禁止使用 console.log'] });
    expect(result.rules).toContain('禁止使用 console.log');
  });

  it('throws on invalid language value', () => {
    expect(() => parseRepoConfig({ language: 'fr' })).toThrow();
  });

  it('throws on invalid selfCritiqueThreshold (out of range)', () => {
    expect(() => parseRepoConfig({ selfCritiqueThreshold: 1.5 })).toThrow();
  });
});

describe('loadRepoConfig', () => {
  it('returns default config when given null or empty string', () => {
    const nullResult = loadRepoConfig(null);
    expect(nullResult.language).toBe('zh');
    expect(nullResult.rules).toEqual([]);

    const emptyResult = loadRepoConfig('');
    expect(emptyResult.language).toBe('zh');
  });

  it('parses valid yaml content', () => {
    const yaml = `
language: en
rules:
  - "No any type"
selfCritiqueThreshold: 0.8
maxFilesPerReview: 10
`;
    const result = loadRepoConfig(yaml);
    expect(result.language).toBe('en');
    expect(result.rules).toEqual(['No any type']);
    expect(result.selfCritiqueThreshold).toBe(0.8);
    expect(result.maxFilesPerReview).toBe(10);
  });

  it('falls back to default config when yaml parsing fails', () => {
    const invalidYaml = `
language: [unclosed array
`;
    const result = loadRepoConfig(invalidYaml);
    expect(result.language).toBe('zh');
    expect(result.rules).toEqual([]);
  });
});
