import { describe, expect, it } from 'vitest';
import {
  DIGIT_LOCALIZER_CACHE_SIZE,
  createDigitLocalizer,
  digitLocalizerCacheSize,
} from './localize.js';

describe('createDigitLocalizer cache (security)', () => {
  it('stays bounded when locales come from user input', () => {
    for (let i = 0; i < DIGIT_LOCALIZER_CACHE_SIZE * 4; i++)
      createDigitLocalizer(`en-x-user${i.toString(36)}`);
    expect(digitLocalizerCacheSize()).toBeLessThanOrEqual(DIGIT_LOCALIZER_CACHE_SIZE);
  });
  it('still localizes digits', () => {
    expect(createDigitLocalizer('fa')?.('12.5')).toBe('۱۲٫۵');
    expect(createDigitLocalizer('en')).toBeNull();
  });
});
