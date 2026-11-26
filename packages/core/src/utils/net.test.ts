import { describe, expect, it } from 'vitest';
import {
  ResponseTooLargeError,
  buildUrl,
  readJsonLimited,
  readTextLimited,
  redactUrl,
} from './net.js';

const stream = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });

describe('buildUrl (security)', () => {
  it('encodes path placeholders so symbols cannot add segments or a query', () => {
    expect(
      buildUrl('/api/symbols/{symbol}/candles', { symbol: '../../admin?x=1#', tf: '1h' }),
    ).toBe('/api/symbols/..%2F..%2Fadmin%3Fx%3D1%23/candles?tf=1h');
  });
  it('encodes query keys and values and skips null/undefined', () => {
    expect(
      buildUrl('https://x.test/c', { symbol: 'BTC/USD&admin=1', from: 0, to: undefined, a: null }),
    ).toBe('https://x.test/c?symbol=BTC%2FUSD%26admin%3D1&from=0');
    expect(buildUrl('/c?v=2', { s: 'a b' })).toBe('/c?v=2&s=a%20b');
    expect(buildUrl('/c?', { s: 1 })).toBe('/c?s=1');
    expect(buildUrl('/c#top', { s: 1 })).toBe('/c?s=1#top');
  });
  it('rejects missing or empty placeholders and ignores inherited keys', () => {
    expect(() => buildUrl('/s/{symbol}', {})).toThrow(/missing/);
    expect(() => buildUrl('/s/{symbol}', { symbol: '' })).toThrow(/empty/);
    expect(() => buildUrl('/s/{constructor}', {})).toThrow(/missing/);
  });
});

describe('redactUrl (security)', () => {
  it('removes credentials, query and fragment', () => {
    expect(redactUrl('https://user:secret@api.x.test/v1/candles?apikey=SECRET&s=1#f')).toBe(
      'https://api.x.test/v1/candles?…',
    );
    expect(redactUrl('/api/candles?token=abc')).toBe('/api/candles?…');
    expect(redactUrl('wss://x.test/stream')).toBe('wss://x.test/stream');
  });
});

describe('readTextLimited / readJsonLimited (security)', () => {
  it('rejects a declared Content-Length over the limit without reading', async () => {
    const headers = new Headers({ 'content-length': '999999' });
    await expect(readTextLimited({ headers, text: async () => 'x' }, 10)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });
  it('stops streaming once the limit is passed', async () => {
    await expect(
      readTextLimited({ body: stream(['12345', '67890', 'abcde']) }, 8),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(await readTextLimited({ body: stream(['{"a":', '1}']) }, 100)).toBe('{"a":1}');
  });
  it('limits text() bodies and parses JSON', async () => {
    await expect(readJsonLimited({ text: async () => '[1,2,3]' }, 3)).rejects.toThrow(/limit/);
    expect(await readJsonLimited({ text: async () => '[1,2,3]' }, 100)).toEqual([1, 2, 3]);
    expect(await readJsonLimited({ json: async () => [1] }, 100)).toEqual([1]);
  });
});
