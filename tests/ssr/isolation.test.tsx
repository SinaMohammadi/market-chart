// Request isolation on the server: nothing one render does may leak into the next render (another user).
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { useI18n, useTranslation } from '@market-chart/react';
import { createDigitLocalizer } from '@market-chart/core';

function Label() {
  const { t } = useTranslation();
  return <span>{t('menu.resetView')}</span>;
}

/** A component that changes the language of the instance it gets (e.g. from a user's saved preference). */
function PersianUser() {
  const i18n = useI18n();
  i18n.setLocale('fa');
  i18n.override('en', { 'menu.resetView': 'LEAKED' });
  return <Label />;
}

describe('SSR request isolation (security)', () => {
  it('a render without a provider cannot change the language of later renders', () => {
    // Before the fix all server renders shared one module-level instance: this switched it to Persian
    // (and overrode a text) for every later request.
    renderToString(<PersianUser />);
    const second = renderToString(<Label />);
    expect(second).toContain('Reset chart view');
    expect(second).not.toContain('LEAKED');
  });

  it('user-controlled locales do not grow server caches without bound', async () => {
    const { digitLocalizerCacheSize } = await import('../../packages/core/src/format/localize.js');
    for (let i = 0; i < 1000; i++) createDigitLocalizer(`en-x-r${i}`);
    expect(digitLocalizerCacheSize()).toBeLessThanOrEqual(64);
  });
});
