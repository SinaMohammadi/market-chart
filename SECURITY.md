# Security policy

## Supported versions

market-chart is pre-1.0. Security fixes are released for the **latest published minor version** only.

| Version        | Supported                          |
| -------------- | ---------------------------------- |
| 0.1.x (latest) | Yes                                |
| Older          | No — upgrade to the latest version |

After 1.0, the latest major version and the previous one (for six months after a new major) will receive fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

1. Use GitHub's private reporting: **Security → Report a vulnerability** on the repository
   (GitHub "private vulnerability reporting" must be enabled by the maintainer in the repository settings).
2. Include the affected package and version, a description, a minimal reproduction, and the impact you see.

What to expect: an acknowledgement within 7 days, an assessment within 14 days, and a fix or mitigation plan for
confirmed issues. We coordinate the disclosure date with you and credit you in the advisory unless you prefer not
to be named. Please give us a reasonable time (normally 90 days) before publishing details.

## What the library protects against

market-chart is a client-side charting library. It treats everything that comes from outside the application's
own code as **untrusted data** and validates it:

| Input                                                                          | Where it enters                                                                       | What the library does                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chart data                                                                     | `series.setData/update`, datafeeds                                                    | Non-finite values rejected; datafeed candles outside the Date range or beyond ±1e18 dropped                                                                                                                                                                          |
| Datafeed responses (REST, WebSocket, SSE)                                      | `createRestDatafeed`, `createWebSocketDatafeed`, `createSseDatafeed`, your `Datafeed` | Candles normalised and validated; symbol info sanitised (`sanitizeSymbolInfo`); response size (`maxResponseBytes`, 64 MiB) and message size (`maxMessageBytes`, 4 MiB) limits; timeouts; retries with backoff; WebSocket reconnects with jitter                      |
| Imported CSV / JSON files                                                      | `parseCsv`, `parseJsonCandles`, `parseCandleFile`                                     | Size (`maxBytes`, 100 MiB, checked before the file is read) and row (`maxRows`, 5M) limits; malformed rows dropped and counted                                                                                                                                       |
| Stored layouts and preferences (localStorage, sessionStorage, IndexedDB, REST) | `@market-chart/persistence`, `UiPreferencesStore`                                     | Plain-JSON only (`sanitizeJson`: no functions, no class instances, no `__proto__`/`constructor`/`prototype` keys, depth/length limits), versioned migrations, per-field validation, only the persisted chart option groups are applied (never size or host settings) |
| Cross-tab messages                                                             | `BroadcastChannel` in `ChartPersistence`                                              | Exact message shape required; anything else ignored. A message only triggers a reload from storage, which is validated again                                                                                                                                         |
| Drawing text and styles                                                        | `DrawingManager.load`, the UI                                                         | Rendered as canvas text or React text nodes (never HTML); length, colour and number ranges checked; at most 5000 drawings per load                                                                                                                                   |
| Indicator parameters and styles                                                | `IndicatorManager.restore`                                                            | Unknown or inherited keys rejected, numeric ranges enforced (e.g. lengths ≤ 5000); at most 100 indicators per restore                                                                                                                                                |
| Translations                                                                   | `I18n.register/extend/override`                                                       | Prototype keys dropped; interpolation only uses own string/number values; output is text, never HTML                                                                                                                                                                 |
| URLs                                                                           | `buildUrl`, adapters                                                                  | Ids are validated and encoded; `buildUrl` encodes every value; error messages use `redactUrl` (no query string or credentials)                                                                                                                                       |
| CSV export, downloads                                                          | `seriesCsv`, `csvCell`, `downloadFile`                                                | Spreadsheet formulas neutralised; file names sanitised (`safeFileName`)                                                                                                                                                                                              |
| Documentation Markdown                                                         | `apps/docs`                                                                           | Rendered as React text; only `http(s):`/`mailto:` links leave the site; bounded regular expressions                                                                                                                                                                  |

Symbol selection, price actions and trading overlays (all optional):

| Input | Where it enters | What the library does |
|---|---|---|
| Symbol lists and search results | `symbols.list()`, `symbols.search()` | `normalizeSymbolItem`: symbols 1–64 characters without control or bidi characters; texts cleaned and bounded; icons only `http(s)`/`data:image` URLs or registered icon names, loaded with `referrerpolicy="no-referrer"`; results capped at `limit`; stale responses aborted and ignored |
| Favourite and recent symbols | stored preferences (version 3) | Validated on load; at most 200 favourites and 50 recent symbols |
| Orders, positions, alerts, markers | `createTradingOverlay` (`set…`, `upsert…`) | `normalizeOrder` and friends: string ids (≤ 128 characters), `buy`/`sell` sides, finite prices, non-negative quantities, known statuses; labels plain text without control or bidi characters (≤ 60 characters); colours only from a plain CSS allow-list; at most 10,000 objects per kind |
| Order-ticket input and answers | the ticket fields, your `submit` result | Values validated against your field rules; numbers parsed strictly (Latin, Persian, Arabic digits); your messages and thrown errors shown as plain text (≤ 300 characters) |
| Extension preferences | `UiPreferences.extensions` | Plain JSON per namespace, at most 16 KB each and 50 namespaces; each package validates its own namespace |

No part of the library uses `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function` or `document.write`.

## What the library does not protect against

The application that uses market-chart owns:

- **Authentication and authorisation.** The REST persistence adapter sends `If-Match` with the previous revision;
  the **server** must check that the user may write the layout id and must reject stale revisions (409/412).
  A client-side conflict strategy (`overwrite`) only decides what this client sends; it cannot and must not be
  what protects other users' data.
- **Server and API security**: rate limiting, input validation on your endpoints, CORS, TLS.
- **Data licensing** and the correctness of market data.
- **Secrets.** Anything in a browser bundle is public. Never put API keys or tokens for a market-data provider in
  client code; proxy the provider through your server and authenticate the user there.
- **Plugins, custom actions, custom icons, custom series and indicator definitions are code.** They run with the
  full rights of the page. Only install plugins you trust; `registerIcon` accepts path data only.
- **Same-origin scripts.** Any script on your origin can read and write your Web Storage, IndexedDB and
  BroadcastChannel. Stored data is validated, but it is not secret and not tamper-proof.

## Security guidance for applications

### Content-Security-Policy

The library works under a strict CSP. It needs no `unsafe-eval`, no inline scripts and no third-party origins.

```text
default-src 'self'; script-src 'self'; style-src 'self' 'nonce-<per-request nonce>';
img-src 'self' data: blob:; connect-src 'self' wss://your-feed.example; object-src 'none';
base-uri 'self'; frame-ancestors 'none'
```

- `@market-chart/ui` injects its stylesheet in a `<style>` element. Under `style-src` without `'unsafe-inline'`,
  pass your nonce: `<UiStylesProvider nonce={nonce}>…</UiStylesProvider>`, or set `inject={false}` and ship the
  `UI_CSS` string as a static `.css` file from your origin (`style-src 'self'`).
- Inline `style` attributes set by React in the browser are allowed by CSP (they go through the CSSOM). Server-
  rendered markup with `style="…"` attributes (`<Chart>` containers, `ChartLayout`, `StaticChart`) needs
  `style-src-attr 'unsafe-inline'` (low risk: it cannot run script); without it those elements are unstyled
  until the client renders them.
- `img-src blob:` is needed for screenshots (`takeScreenshot`, the "Export image" action); `data:` only if you
  use data URLs yourself.
- Next.js App Router needs a per-request nonce (middleware) for a script CSP; see `apps/nextjs/next.config.mjs`
  for the headers that need none.

The documentation site ships a ready-to-use header set in `apps/docs/public/_headers` (Netlify / Cloudflare Pages
format) and a baseline `<meta http-equiv="Content-Security-Policy">` in `apps/docs/index.html` for hosts that
cannot send headers. Recommended headers for any host:

```text
Content-Security-Policy: (see above)
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
X-Frame-Options: DENY
```

### Datafeeds

- Build request URLs with `buildUrl('/api/{symbol}/candles', { symbol, from, to })`; never concatenate symbols.
- Keep the default `credentials: 'same-origin'`. Use `'include'` only for a trusted cross-origin API.
- Keep tokens out of URLs where you can (use headers). If a token must be in a WebSocket URL, make it short-lived.
- Keep the size limits; lower them if your messages are small. Set `maxBars` on `DatafeedController` for long
  realtime sessions.
- Validate data on your server too: the library protects the page, not your database.

### Stored layouts

- Treat imported layout files like any upload: check `file.size` before `file.text()` and show validation
  errors (`importJson` throws `PersistenceError`).
- Use a storage `prefix` (Web Storage) or `dbName` (IndexedDB) specific to your application, so another app on
  the same origin cannot collide with your keys.
- Handle `StorageQuotaError` (Web Storage is about 5 MB per origin).
- Layouts are not secret: do not store personal or confidential data in `extensions`.

### Server rendering

- Wrap each request's tree in its own `<ChartProvider>` with the user's locale. Without a provider every server
  component gets its own default English `I18n`, so nothing leaks between requests.
- `registerIcon` and custom tool/indicator registries are process-wide: register them at startup, never from
  request data.

### Trading interfaces

The order ticket and the trading overlay never send anything themselves: they call your callbacks. The security of
order handling is therefore in your application and back end:

- **Authorise on the server.** Treat every `submit`, `onModify`, `onCancel` and `onClosePosition` call as a request
  from an untrusted client: check the user, the account and the object id on the server, never trust prices,
  quantities or ids only because the chart produced them.
- **Make requests idempotent.** Send a client-generated id with each submission so a reconnect or a user retry
  cannot create a second order. The ticket refuses a second submission while one is pending and never retries,
  but network layers may.
- **Keep the server authoritative.** Push order and position updates from your back end (`upsertOrder`, `setOrders`)
  and show authoritative state outside the chart. A rejected `onModify` snaps the line back; a resolved one keeps the
  new price only until your next update.
- **Keep confirmation on** for real accounts (`allowSkipConfirmation` is off by default).
- **Label simulations.** Set `trading.simulatedLabel` in demos and paper-trading modes so users cannot mistake them
  for real orders.

## Supply chain

- The published packages have **no runtime dependencies** besides each other (`react`/`react-dom` are peer
  dependencies) and **no install scripts**. Tarballs contain only `dist/`, `README.md`, `LICENSE` and
  `package.json` (checked by `tests/repo/publishing.test.ts`).
- Enable 2FA for publishing on the npm account and organisation, prefer publishing from CI with
  `npm publish --provenance` (requires the `repository` field), and protect the release branch.
