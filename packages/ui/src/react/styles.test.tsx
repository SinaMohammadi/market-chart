// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UiStylesProvider, useUiStyles } from './styles.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Uses() {
  useUiStyles();
  return null;
}

async function render(node: React.ReactNode): Promise<() => void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return () => {
    act(() => root.unmount());
    container.remove();
  };
}

// Other components (earlier tests in the same page) may already have injected the stylesheet.
beforeEach(() => document.getElementById('market-chart-ui-styles')?.remove());
afterEach(() => document.getElementById('market-chart-ui-styles')?.remove());

describe('useUiStyles under a Content-Security-Policy (security)', () => {
  it('puts the CSP nonce on the injected style element', async () => {
    const done = await render(
      <UiStylesProvider nonce="r4nd0m">
        <Uses />
      </UiStylesProvider>,
    );
    const style = document.getElementById('market-chart-ui-styles') as HTMLStyleElement;
    expect(style).not.toBeNull();
    expect(style.nonce).toBe('r4nd0m');
    done();
  });
  it('injects nothing when the application ships the CSS itself', async () => {
    const done = await render(
      <UiStylesProvider inject={false}>
        <Uses />
      </UiStylesProvider>,
    );
    expect(document.getElementById('market-chart-ui-styles')).toBeNull();
    done();
  });
  it('still injects by default', async () => {
    const done = await render(<Uses />);
    expect(document.getElementById('market-chart-ui-styles')).not.toBeNull();
    done();
  });
});
