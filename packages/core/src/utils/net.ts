import { ChartError } from './errors.js';

/**
 * Network helpers shared by the datafeed and persistence adapters. They never touch globals at import time.
 */

export type UrlParamValue = string | number | boolean | null | undefined;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Builds a URL from a template and parameters, encoding every value. `{name}` placeholders in the template are
 * replaced with the path-encoded parameter (`BTC/USD` → `BTC%2FUSD`, so a symbol can never add path segments
 * or a query); the remaining parameters are appended as an encoded query string. `null`/`undefined` values are
 * skipped. Use it instead of string concatenation whenever a symbol, id or user input goes into a URL.
 *
 * ```ts
 * buildUrl('/api/symbols/{symbol}/candles', { symbol: 'BTC/USD', tf: '1h', from: 0 })
 * // → '/api/symbols/BTC%2FUSD/candles?tf=1h&from=0'
 * ```
 */
export function buildUrl(
  template: string,
  params: Readonly<Record<string, UrlParamValue>> = {},
): string {
  if (typeof template !== 'string') throw new ChartError('buildUrl() needs a URL template string');
  const used = new Set<string>();
  const hashAt = template.indexOf('#');
  const base = hashAt >= 0 ? template.slice(0, hashAt) : template;
  const hash = hashAt >= 0 ? template.slice(hashAt) : '';
  const path = base.replace(PLACEHOLDER, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name))
      throw new ChartError(`buildUrl(): missing value for {${name}}`);
    const value = params[name];
    if (value === null || value === undefined || value === '')
      throw new ChartError(`buildUrl(): {${name}} must not be empty`);
    used.add(name);
    return encodeURIComponent(String(value));
  });
  const query: string[] = [];
  for (const key of Object.keys(params)) {
    if (used.has(key)) continue;
    const value = params[key];
    if (value === null || value === undefined) continue;
    query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (!query.length) return path + hash;
  const joiner = path.includes('?') ? (/[?&]$/.test(path) ? '' : '&') : '?';
  return `${path}${joiner}${query.join('&')}${hash}`;
}

/**
 * A URL that is safe to put in error messages and logs: credentials (`user:pass@`), the query string and the
 * fragment are removed, since API keys and tokens usually live there. `https://u:p@api.x.com/a?key=1` →
 * `https://api.x.com/a?…`.
 */
export function redactUrl(url: string): string {
  const text = String(url);
  const cut = text.search(/[?#]/);
  const head = cut >= 0 ? text.slice(0, cut) : text;
  const withoutUser = head.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, '$1');
  return cut >= 0 ? `${withoutUser}?…` : withoutUser;
}

/** Minimal `Response` surface read by {@link readJsonLimited} (test doubles may implement only `json`). */
export interface ResponseLike {
  readonly headers?: { get(name: string): string | null } | null;
  readonly body?: ReadableStream<Uint8Array> | null;
  text?(): Promise<string>;
  json?(): Promise<unknown>;
}

/** Thrown when a response or message is larger than the configured limit. */
export class ResponseTooLargeError extends ChartError {
  constructor(readonly limit: number) {
    super(`response is larger than the limit of ${limit} bytes`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Reads a response body as text, stopping as soon as it exceeds `maxBytes` (checked against `Content-Length`
 * first, then while streaming), so a misbehaving server cannot make the page buffer gigabytes.
 */
export async function readTextLimited(response: ResponseLike, maxBytes: number): Promise<string> {
  const declared = Number(response.headers?.get?.('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new ResponseTooLargeError(maxBytes);
  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new ResponseTooLargeError(maxBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }
  if (typeof response.text === 'function') {
    const text = await response.text();
    // UTF-16 length is a lower bound of the UTF-8 size: good enough for a safety limit.
    if (text.length > maxBytes) throw new ResponseTooLargeError(maxBytes);
    return text;
  }
  throw new ChartError('response has no readable body');
}

/**
 * Reads a JSON body within `maxBytes`. Falls back to `response.json()` (no streaming limit, only the
 * `Content-Length` check) for minimal response doubles that implement nothing else.
 */
export async function readJsonLimited(response: ResponseLike, maxBytes: number): Promise<unknown> {
  if (!response.body?.getReader && typeof response.text !== 'function') {
    const declared = Number(response.headers?.get?.('content-length') ?? Number.NaN);
    if (Number.isFinite(declared) && declared > maxBytes) throw new ResponseTooLargeError(maxBytes);
    if (typeof response.json === 'function') return response.json();
  }
  return JSON.parse(await readTextLimited(response, maxBytes)) as unknown;
}
