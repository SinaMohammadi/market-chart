import { describe, expect, it } from 'vitest';
import { CORE_VERSION, satisfiesVersion } from './version.js';

describe('satisfiesVersion', () => {
  it('handles exact, comparison, caret, tilde, AND and OR ranges', () => {
    expect(satisfiesVersion('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesVersion('1.2.3', '*')).toBe(true);
    expect(satisfiesVersion('1.2.3', '>=1.2.0 <2.0.0')).toBe(true);
    expect(satisfiesVersion('2.0.0', '>=1.2.0 <2.0.0')).toBe(false);
    expect(satisfiesVersion('1.9.0', '^1.2.3')).toBe(true);
    expect(satisfiesVersion('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesVersion('0.2.9', '^0.2.3')).toBe(true);
    expect(satisfiesVersion('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfiesVersion('0.0.4', '^0.0.3')).toBe(false);
    expect(satisfiesVersion('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesVersion('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfiesVersion('3.0.0', '^1.0.0 || ^3.0.0')).toBe(true);
    expect(satisfiesVersion('1.0.0-beta.1', '1.0.0')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(() => satisfiesVersion('x', '1.0.0')).toThrow(/invalid version/);
    expect(() => satisfiesVersion('1.0.0', '^banana')).toThrow(/invalid version range/);
  });

  it('exposes a valid core version', () => {
    expect(satisfiesVersion(CORE_VERSION, '>=0.1.0')).toBe(true);
  });
});
