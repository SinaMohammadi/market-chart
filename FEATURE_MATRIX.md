# Feature matrix

Status legend: **Complete** — implemented, tested, documented · **Partial** — works with stated limits ·
**Interface** — public contract defined, no implementation yet · **Planned** — not started.

Tests legend: **Passed** — automated tests exist and passed in the last verification run ·
**Manual** — verified by hand in a browser, no automated test yet · **Pending** — no tests yet.

_Last updated: documentation review, legal notes and deployment guide (2026-11-26); before that, symbols, price
actions and trading objects (2026-11-26). The security review follows; the
previous verification tables follow the [Security](#security) section._

## Symbols, price actions and trading objects

All optional: nothing below is installed or bundled unless the application lists it. The library never
trades; every example and demo is **simulated** (generated symbols, an in-memory broker with random latency and
rejections).

| Feature | Status | Package | Automated tests |
|---|---|---|---|
| Symbol source (`symbols` capability: `value`, `set`, cancellable `search`, static `list`, `groups`); legacy `symbol` capability still works | Complete | ui | `ui/src/features.test.ts` |
| Selector modes `dropdown`, `modal`, `both`, `custom`, `none` (preference with app default, settings entry); `Mod+K` and type-to-search | Complete | ui | `features.test.ts`, `react/features.test.tsx` |
| Search dialog: debounce, group tabs (`groupOrder`), favourites and recents (persisted), loading/empty/error + retry, stale requests aborted and ignored, keyboard, virtualised list | Complete | ui | `features.test.ts`, `react/features.test.tsx`, Chromium `react/features.browser.test.tsx` |
| Dialog accessibility: combobox/listbox ARIA, focus trap and restore, RTL, full screen on small screens | Complete | ui | jsdom + Chromium; full-screen layout checked by hand (375×812) |
| Header dropdown (popover, filter, select, focus restore, RTL placement) | Complete | ui | `react/features.test.tsx`, Chromium |
| Customisation: item/empty/error views, `limit`, `sort`, `groupOrder`, hide favourites/recents, `useSymbolSearch`, `ui.symbols.open/close` | Complete | ui | `features.test.ts`, `react/features.test.tsx` (custom selector) |
| Compare mode (`compare.add`) | Complete | ui | `features.test.ts` |
| Price actions: registry `priceAction`, `ActionContext.price` (rounded to `minMove`, side, symbol), `{price}` labels, submenus | Complete | ui | `features.test.ts` |
| Entry points: context menu "At this price", "+" button at the crosshair, shortcuts at the crosshair, touch long-press menu; each switchable | Complete (touch: simulated events only) | ui | `features.test.ts`, `react/features.test.tsx` |
| Built-ins `price.buy`, `price.sell`, `price.order`, `price.alert`, `price.copy` | Complete | ui | `features.test.ts` |
| Order ticket: declared fields and validation, Persian/Arabic digits, idle → confirming → submitting → accepted/rejected, no retries, double-submit guard, confirm button armed after 400 ms, skip-confirmation only when allowed, `useOrderTicket` | Complete | ui | `features.test.ts`, `react/features.test.tsx`, Chromium |
| `@market-chart/trading`: orders, positions with TP/SL, alerts, custom markers; `set/upsert/remove`, validation | Complete | trading | `trading.test.ts`, `overlay.integration.test.ts` |
| Display: line, stacked labels, axis labels (engine price lines), colours by side and status, P&L text from the app, compact labels, follows pan/zoom/pane moves | Complete | trading | `overlay.integration.test.ts` |
| Interaction: drag to modify (pending, snaps back on reject), × cancel, close position, click/double-click, hover tooltip, cursors | Complete | trading | `overlay.integration.test.ts`, Chromium `overlay.browser.test.ts` |
| With `ChartUi`: context-menu targets `order`/`position`/`alert`/`marker` and actions, object-tree sections (focusable rows), Trading settings, preferences in `extensions.trading`, en/fa/ar texts | Complete | trading | `overlay.integration.test.ts`, `react/react.test.tsx` |
| React: `<TradingOverlay>`, `useTradingOverlay` | Complete | trading | `react/react.test.tsx` |
| Realtime batching (one rebuild per task) and benchmark with budgets | Complete | trading | `benchmarks/trading.perf.ts` |
| Security: application labels as plain text (control/bidi removed, bounded), CSS colour allow-list, validated objects and symbols, bounded counts and preference sizes | Complete | ui, trading, core | `trading.test.ts`, `overlay.integration.test.ts`, `features.test.ts`, `react/features.test.tsx` |
| Core primitives: `layoutLabels` exported (generic), `priceTickSize`, `roundToTick`, `safeText` | Complete | core | `features.test.ts` (rounding), existing `chart-helpers.test.ts` |
| Docs: 8 simulated examples, reference page, builder options; playground trading page | Complete | docs, playground | docs build; checked by hand (below) |

### Verification of this update

| Check | Result |
|---|---|
| `vitest run`, all 14 projects (new: `trading`) | 641 passed, 9 skipped (6 new skips are the Chromium-only suites, run below) |
| Real Chromium: React, UI and new suites (incl. `features.browser.test.tsx`, `overlay.browser.test.ts`) | 31/31 passed (hidden pane; frames driven by MessageChannel) |
| Strict `tsc`: package sources and tests (sources mapped), `tests/`, `benchmarks/`, docs site, playground | Passed |
| `pnpm lint` (ESLint) | Passed (0 problems) |
| `pnpm bench` | 15/15 within budget. Trading: `setOrders(1,000)` + frame 6.2 ms; 1,000 status changes + frame 5.6 ms; pan p95 with 1,000 orders 3.9 ms (0.6 ms baseline); hit test 4.5 µs |
| `pnpm install` | Ran once, unintentionally, during the documentation work (a shell-quoting mistake; no package was published or logged in). It linked the new package and updated `pnpm-lock.yaml`; run it yourself again before releasing |
| `pnpm build` | Passed, all 11 packages. The trading main entry imports only `@market-chart/core`; its React entry is `"use client"` |
| `pnpm typecheck` (all packages, apps, `tests/`, `benchmarks/`) | Passed. It found that the React entries of `ui`, `indicators`, `drawing-tools`, `datafeed`, `persistence` and `trading` re-declared their classes in `react.d.ts` (e.g. `ChartUi`), so values from the two entries were incompatible types for users. Fixed: declarations of both entries are now built in one pass and share one chunk (`tsup.config.ts`); checked that no `react.d.ts` declares a class any more |
| `pnpm docs:build`; built site under the `_headers` CSP in Chromium | Passed; 18 examples render, no failed examples, no console errors |
| Bundle without opting in (esbuild, minified, against `ui/dist`) | No feature code included (60.4 KB); all three features +25.9 KB; React views of symbol search (6.5 KB) and ticket (5.3 KB) are lazy chunks |
| Regression proof | Snap-back reverted → its test fails; the virtualised-list fix was found by the Chromium test (failed before, passes after). The confirm-arming test was written with the fix and not run against the code without it |

Checked by hand in the browser (docs dev site, Chromium): header dropdown (open, filter, Enter, focus back on
the button); "+" button at the crosshair price rounded to the 0.5 tick, its menu (buy stop / sell limit / order
at / alert), the ticket's review → send → "Simulated order … accepted"; dragging an order line (grey while
pending, then accepted); Persian RTL demo (mirrored header, right-to-left labels with × at the start,
translated texts); the search dialog full screen at 375×812. This found one issue, fixed and tested: "Send
order" appears where "Review order" was, so a double-click could send without the summary being seen.

Not verified: frame times with 1,000 orders on a real canvas (the pane was hidden, so its frame rate was
throttled; use the playground's "Add 1,000 orders" button), touch long-press on a real touch device, screen
readers, the Next.js example.

Limitations: labels on the canvas are reached by screen readers through the object tree, not on the chart;
the "+" button follows the pointer (keyboard users use the context-menu key and shortcuts); price-action
shortcuts compare `event.key` (on macOS `Alt`+letter types another character); price actions are not listed in
the shortcut settings; one overlay per `ChartUi` registers the context-menu actions; with very large order
books, the engine's axis labels dominate the frame time (`axisLabels: false` helps).

## Security

Review of all packages, the docs site, the example apps and the build/publish configuration. Threat model,
reporting process and guidance for applications: [SECURITY.md](SECURITY.md). Every **Fixed** finding has a
regression test that was run against the unfixed code (each fix reverted one at a time) and failed there, except
where the table says otherwise.

| ID | Severity | Area | Location | Finding | Fix | Test | Status | Package |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | Medium | Stored state | `persistence/src/chart-persistence.ts:218` | `apply()`/`importJson()` passed every stored option to `applyOptions`: a layout could set `width`/`height` to 1e9 (huge canvas allocation), `autoSize`, `panes` | Only the persisted option groups are applied | `persistence/src/security.test.ts` | Fixed | persistence |
| SEC-02 | Medium | Formatting | `core/src/format/price-format.ts:20` | A `precision` outside 0–100 (or NaN) from a datafeed or stored options made `toFixed` throw on every frame: the chart stopped drawing | `safePrecision` clamps to [0, 20]; non-positive `minMove` and unknown types ignored | `core/src/format/price-format.test.ts` | Fixed | core |
| SEC-03 | Medium | Datafeed | `datafeed/src/controller.ts:54, :264` | Symbol info from the network used unvalidated (precision, NaN/string history bounds, huge strings) | `sanitizeSymbolInfo` | `datafeed/src/security.test.ts` (new function; no "before" state) | Fixed | datafeed |
| SEC-04 | Medium | Network | `datafeed/src/adapters.ts:303`, `persistence/src/adapters.ts:319` | Error messages contained full URLs, including API keys in query strings and `user:password@` | `redactUrl` in every message | `datafeed/src/security.test.ts`, `persistence/src/security.test.ts` | Fixed | core, datafeed, persistence |
| SEC-05 | Medium | Network | `datafeed/src/adapters.ts:309, :496, :629`, `persistence/src/adapters.ts:319` | No size limit on REST responses, WebSocket or SSE messages | `readJsonLimited`/`readTextLimited` (`maxResponseBytes` 64 MiB datafeed, 20 MiB storage), `maxMessageBytes` 4 MiB | `core/src/utils/net.test.ts`, `datafeed/src/security.test.ts`, `persistence/src/security.test.ts` | Fixed | core, datafeed, persistence |
| SEC-06 | Medium | Network | `datafeed/src/adapters.ts:483` | WebSocket backoff reset on `open`: a server that accepts and drops connections was hit every 500 ms forever; no jitter (reconnect storms) | Reset only after a message or `maxDelayMs` of uptime; `reconnect.jitter` (default 0.5) | `datafeed/src/security.test.ts` | Fixed | datafeed |
| SEC-07 | Medium | CSP | `ui/src/react/styles.ts:186` | The injected `<style>` is blocked under `style-src` without `'unsafe-inline'` (verified in Chromium: `style-src-elem` violation, UI unstyled); no nonce or opt-out | `UiStylesProvider` with `nonce` or `inject={false}` | `ui/src/react/styles.test.tsx` (jsdom + Chromium) and a strict-CSP page in Chromium | Fixed | ui |
| SEC-08 | Medium | SSR | `react/src/i18n.tsx:20` | Without a provider, all server renders shared one module-level `I18n`: `setLocale`/`override` in one request leaked into the next | Per-component instance on the server | `tests/ssr/isolation.test.tsx` | Fixed | react |
| SEC-09 | Medium | Import | `datafeed/src/parse.ts:16` | CSV/JSON import had no size or row limit; files were read completely | `maxBytes` (100 MiB, `file.size` checked before reading), `maxRows` (5M) | `datafeed/src/security.test.ts` | Fixed | datafeed |
| SEC-10 | Medium | URLs / docs | `core/src/utils/net.ts:22`, `datafeed/README.md`, `docs/SSR.md` | The documentation taught concatenating symbols into URLs; no encoding helper existed | `buildUrl` (path placeholders and query encoded); examples updated | `core/src/utils/net.test.ts`, `datafeed/src/security.test.ts` | Fixed | core, datafeed |
| SEC-11 | Low | Network | `datafeed/src/adapters.ts:298`, `persistence/src/adapters.ts:319` | `credentials` mode implicit; REST storage had no timeout | `credentials` option sent explicitly (default `'same-origin'`); `timeoutMs` (15 s) | `datafeed/src/security.test.ts`, `persistence/src/security.test.ts` | Fixed | datafeed, persistence |
| SEC-12 | Low | Network | `datafeed/src/adapters.ts:354` | A huge range with a small `maxBarsPerRequest` produced millions of requests | `maxRequestsPerRange` (1000) | `datafeed/src/security.test.ts` (not run against the unfixed code: it would allocate millions of request objects) | Fixed | datafeed |
| SEC-13 | Low | Network | `datafeed/src/adapters.ts:339` | Search responses used unvalidated | Array check, `symbol` string required, max 1000 | `datafeed/src/security.test.ts` | Fixed | datafeed |
| SEC-14 | Low | Datafeed | `datafeed/src/adapters.ts:33` | Subscription keys split on `\|`: a symbol containing `\|` was resubscribed as a different symbol after reconnect | Symbol and interval stored as given | `datafeed/src/security.test.ts` | Fixed | datafeed |
| SEC-15 | Low | Chart data | `datafeed/src/candles.ts:86` | Candles with times outside the Date range or absurd values accepted (CSV export and date formatting then threw) | `MAX_CANDLE_TIME`, `MAX_CANDLE_VALUE` (±1e18) | `datafeed/src/security.test.ts` | Fixed | datafeed |
| SEC-16 | Low | Export | `ui/src/util.ts:156, :170` | CSV cells not escaped (formula injection; built-in series only export numbers, so defence in depth) and an out-of-range time made the export throw | `csvCell`/`csvRow` (formula prefix `'`, quoting) | `ui/src/security.test.ts` | Fixed | ui |
| SEC-17 | Low | Export | `ui/src/util.ts:119` | Download names passed unsanitised to the browser and to `capabilities.download` (path, control and bidi characters) | `safeFileName` | `ui/src/security.test.ts` | Fixed | ui |
| SEC-18 | Low | Cross-tab | `persistence/src/chart-persistence.ts:371` | Channel messages with NaN/Infinity/fractional revisions or non-string origins accepted (spurious reloads) | Exact shape required | `persistence/src/security.test.ts` | Fixed | persistence |
| SEC-19 | Low | Storage | `persistence/src/adapters.ts:106, :379` | Web Storage index returned unvalidated entries; REST list names unbounded | `validateLayoutMetadata` | `persistence/src/security.test.ts` | Fixed | persistence |
| SEC-20 | Low | Storage | `persistence/src/schema.ts:185` | Workspace grid `columns`/`rows` unbounded (negative, 1e9) | 1–8 each | `persistence/src/security.test.ts` | Fixed | persistence |
| SEC-21 | Low | Storage | `persistence/src/schema.ts:61` | `parseJson` had no size limit | `maxBytes` (20 MiB) | `persistence/src/security.test.ts` | Fixed | persistence |
| SEC-22 | Low | Translations | `i18n/src/i18n.ts:281, :376` | Inherited members used as messages (`t('toString')` crashed) and as placeholder values (`{constructor}` printed function source) | Own keys and string/number values only | `i18n/src/i18n.test.ts` | Fixed | i18n |
| SEC-23 | Low | Indicators | `indicators/src/params.ts:57` | Inherited names (`constructor`, `toString`, `__proto__`) accepted as parameters | Own inputs only | `indicators/src/indicators.test.ts` | Fixed | indicators |
| SEC-24 | Low | Indicators | `indicators/src/chart/indicator-manager.ts:677, :855` | `restore()` count unbounded; style colours unchecked | `max` (100); colours ≤ 64-char strings | `indicators/src/chart/manager.integration.test.ts` (Node and Chromium) | Fixed | indicators |
| SEC-25 | Low | Drawings | `drawing-tools/src/manager.ts:409, :478` | `load()` count unbounded; `maxZ` used `Math.max(...all)` (stack overflow on huge sets) | `maxDrawings` (5000); loop | `drawing-tools/src/manager.integration.test.ts` (Node and Chromium) | Fixed | drawing-tools |
| SEC-26 | Low | Icons | `ui/src/icons.ts:87, :98` | `iconPath('constructor')` returned Object members; `registerIcon` path length unbounded | Own keys; 8192-char limit; prototype names rejected | `ui/src/security.test.ts` | Fixed | ui |
| SEC-27 | Low | SSR / DoS | `core/src/format/localize.ts:32` | Digit-localizer cache keyed by user-controlled locale strings grew without bound on servers | 64 entries | `core/src/format/localize.test.ts`, `tests/ssr/isolation.test.tsx` | Fixed | core |
| SEC-28 | Low | Preferences | `ui/src/preferences.ts:228` | Stored action placements, shortcuts, hidden entries and locale length unbounded | 500 entries each; locale ≤ 35 chars | `ui/src/security.test.ts` | Fixed | ui |
| SEC-29 | Low | ReDoS | `apps/docs/src/components/Markdown.tsx:58`, `apps/docs/src/site.tsx:61` | Quadratic regular expressions (backtick runs, `[` runs, `<` runs): 60K characters took seconds. Inputs are the repository's own documents | Bounded quantifiers | `apps/docs/src/components/markdown.test.tsx` | Fixed | docs |
| SEC-30 | Low | Docs links | `apps/docs/src/components/Markdown.tsx:28` | Link schemes were safe by accident (non-`http` fell through to internal routes); made explicit and case/whitespace-insensitive | Scheme allow-list (`http(s)`, `mailto`) | `apps/docs/src/components/markdown.test.tsx` (passes before and after: hardening) | Fixed (hardening) | docs |
| SEC-31 | Low | Docs storage | `apps/docs/src/site.tsx:104` | An unknown stored locale made `ChartProvider` throw and blanked the site | Known languages only | `apps/docs/src/components/markdown.test.tsx` | Fixed | docs |
| SEC-32 | Low | Hosting | `apps/docs/index.html`, `apps/docs/public/_headers`, `apps/docs/public/theme.js` | No CSP or security headers; the inline theme script needed `'unsafe-inline'` | Header set (`_headers`), baseline meta CSP, theme script as a file | Manual in Chromium: dev site and built site under the full header set, no CSP violations | Fixed | docs |
| SEC-33 | Low | Example app | `apps/nextjs/next.config.mjs` | No security headers; `X-Powered-By` sent | Header set, `poweredByHeader: false` | Not verified at runtime (Next.js not started) | Fixed (unverified) | nextjs example |
| SEC-34 | Low | Example app | `apps/playground/src/examples/Persistence.tsx` | Imported files read without a size check | 5 MB check before reading | None (example code) | Fixed | playground |
| SEC-35 | Low | Publishing | `packages/*/package.json`, `.gitignore` | Tarballs had no LICENSE; `.gitignore` missed `.npmrc`, keys, logs, `*.tgz`, editor folders | LICENSE in every package and `files`; ignore rules | `tests/repo/publishing.test.ts` | Fixed | all |
| SEC-36 | Info | Plugins | `core/src/plugins`, `ui/src/registry.ts` | Plugins, custom actions, tools, indicators and series are code with full page rights | Documented | — | Accepted risk | core, ui |
| SEC-37 | Info | SSR / CSP | `react/src/ssr/static-chart.tsx`, `react/src/chart.tsx` | Server-rendered `style="…"` attributes need `style-src-attr 'unsafe-inline'` under a strict CSP; colours come from developer configuration | Documented in SECURITY.md | — | Accepted risk | react |
| SEC-38 | Info | Publishing | `packages/*/tsup.config.ts` | Source maps embed the (public, MIT) sources; paths are relative, no secrets | — | `npm pack --dry-run` listing reviewed | Accepted risk | all |
| SEC-39 | Info | Conflicts | `persistence/src/adapters.ts` (REST `If-Match`) | The `overwrite` strategy is a client choice; protecting other users' data is the server's job (authorise ids, enforce `If-Match`) | Documented | — | Not applicable | persistence |
| SEC-40 | Info | XSS | all packages | No `innerHTML`, `dangerouslySetInnerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` outside tests; text is rendered by React or on the canvas | — | — | Not applicable | all |
| SEC-41 | Info | Browser APIs | `ui/src/util.ts`, `ui/src/builtins/toolbar.ts` | No `window.open`; download links use `rel="noopener"` and blob URLs; clipboard writes only numbers and ISO dates | — | — | Not applicable | ui |
| SEC-42 | Info | Realtime | `datafeed/src/controller.ts` | Rendering is frame-coalesced (99K updates/s benchmark); memory grows with new bars unless `maxBars` is set | Documented | `pnpm bench` | Accepted risk | datafeed |
| SEC-43 | Info | Dependencies | dev tooling | `pnpm audit --prod`: no known vulnerabilities. Full audit: 6 advisories in dev tools only (vitest/@vitest/mocker, tinypool, esbuild via tsup) | Upgrade (maintainer) | — | Open (dev only) | repo |

### Verification of the security update

| Check | Result |
|---|---|
| `vitest run`, all 13 projects (new: `docs`, `repo`) | 571 passed, 3 skipped (same skips as before) |
| Regression tests against the unfixed code (each fix reverted alone, its test run) | 40/40 reverts detected (SEC-12 not reverted, see table) |
| Real Chromium: integration suites | 88/88 passed |
| Real Chromium: React, hydration and UI suites (incl. the style-nonce test) | 34/34 passed (1280×900 viewport) |
| Real Chromium: strict CSP page (`style-src 'self' 'nonce-…'`) | without nonce: stylesheet blocked, 1 violation; with `UiStylesProvider nonce`: applied, 0 violations; `inject={false}`: nothing injected, 0 violations |
| Real Chromium: docs site (dev, meta CSP) and production build under the `_headers` policy | No CSP violations; examples render |
| `pnpm build`, `pnpm -r typecheck`, `tsc -p tests`, `tsc -p benchmarks`, `pnpm docs:build` | Passed |
| `pnpm lint` (ESLint) | Passed (0 problems) |
| `pnpm bench` | 11/11 within budget (setData 1M candles 79.7 ms, pan frame p95 1.06 ms, realtime 97,728 updates/s) |
| `npm pack --dry-run` per package | Only `dist/`, `README.md`, `package.json` before this update; `LICENSE` added |
| `pnpm audit --prod` | No known vulnerabilities |

## Verification of the legend and documentation-site update

Run with the dependencies installed by the maintainer (nothing was installed by the assistant):

| Check | Result |
|---|---|
| `vitest run` (real Vitest 3.2), all 11 projects incl. `i18n` and `ui`, sources resolved through aliases | 487 passed, 3 skipped (IndexedDB suite: jsdom has no IndexedDB; two Chromium-only layout tests) |
| `pnpm bench` (benchmarks with budgets, Node, `--expose-gc`) | 11/11 within budget (setData 1M candles 84 ms, pan frame p95 0.95 ms, realtime 99K updates/s), see [docs/PERFORMANCE.md](docs/PERFORMANCE.md) |
| `pnpm build` (tsup, ESM + CJS + `.d.ts` for all 10 packages) | Passed. `ui` main entry imports only `core`, `i18n`, `persistence` (no React); `ui/react` is `"use client"` with the settings panel in a lazy chunk |
| Strict `tsc` over package sources and tests, `tests/`, `benchmarks/`, playground, docs site | Passed |
| SSR import safety (`tests/ssr/imports.test.ts`, 18 entries incl. `i18n`, `ui`, `ui/react`) and RTL `ChartInterface` hydration | Passed |
| Integration tests in real Chromium (incl. locale, direction and context-menu engine tests, `ChartUi`, legend and price-label suites) | 86/86 passed |
| React client, hydration and UI tests in real Chromium (incl. header overflow, menu positioning, legend and object tree) | 31/31 passed |
| Playground: the 6 new pages (9 demos) in a browser | No console errors. RTL page: header and sidebar mirrored, Persian digits on the axes, menus and submenus open to the left, settings dialog in RTL. Context-menu page: background and candle menus with custom, conditional and plugin actions, headless custom renderer, flipping at the viewport edge. Other interactions are covered by the automated tests only |
| Documentation site (`apps/docs`): production build and all 25 pages in a browser (desktop and phone width) | Build passed; no console errors, no failed examples |
| `pnpm lint` (ESLint) | Passed (0 problems) |

The per-package `pnpm -r typecheck` additionally needs `pnpm install` for the new `i18n` and `ui` packages so
their workspace links exist; the same sources pass through the root `tsc` configurations above.

## Foundation

| Feature | Status | Tests | Package |
|---|---|---|---|
| pnpm monorepo, tsup builds (ESM + CJS + d.ts), changesets, ESLint, Prettier | Complete (configs; not yet executed) | Pending | root |
| Columnar typed-array data store (append / replace / insert, validation) | Complete | Passed | core |
| Shared timeline across series (incremental append, merge) | Complete | Passed | core |
| Time scale: bar spacing, right offset, zoom around anchor, fit, logical/time ranges, edge locks | Complete | Passed | core |
| Price scale: auto-scale, margins, invert, manual scale/pan | Complete | Passed | core |
| Price scale modes: normal, logarithmic, percentage, indexed-to-100 | Complete | Passed | core |
| Price tick generation (nice steps, min-move aware) | Complete | Passed | core |
| Time tick generation (calendar-weighted, stable while scrolling) | Complete | Passed | core |
| Time zones: UTC, local, IANA (DST-aware, cached offsets) | Complete | Passed | core |
| Canvas 2D renderer: DPR-aware, two layers (main/overlay), frame scheduler, viewport culling | Complete | Passed | core |
| Candlestick series | Complete | Passed | core |
| OHLC bar series | Complete | Passed | core |
| Line series (simple / step) | Complete | Passed | core |
| Area series | Complete | Passed | core |
| Baseline series | Complete | Passed | core |
| Histogram series (per-point colours) | Complete | Passed | core |
| Multiple series per pane, overlay price scales (e.g. volume) | Complete | Passed | core |
| Multiple panes (stretch factors, auto-trim) | Complete | Passed | core |
| Crosshair: normal / magnet / hidden, axis labels, multi-series data | Complete | Passed | core |
| Pan (drag), wheel zoom, trackpad pinch, touch pinch | Complete | Passed (drag); wheel/pinch: Manual | core |
| Axis drag scaling, axis double-click reset | Complete | Manual | core |
| Last-value labels and price lines | Complete (with label collision handling) | Passed | core |
| Typed event system (ready, resize, crosshairMove, click, visibleRangeChange, data/series/options/theme, error, destroy) | Complete | Passed | core |
| Dark / light / custom themes | Complete | Passed | core |
| Options validation, prototype-pollution-safe merging | Complete | Passed | core |
| Plugin lifecycle (ids, versions, dependencies, auto-cleanup, isolated failures) | Complete | Passed | core |
| Plugin pane render layers (below / above / top) with coordinate helpers | Complete | Passed | core |
| DOM-free static geometry entry (`@market-chart/core/static`) | Complete | Passed | core |
| `<Chart>`, `<Series>` and typed series components, refs | Complete | Passed | react |
| Incremental React data updates (append / last-bar replace → `update()`) | Complete | Passed | react |
| `ChartProvider`, `useChart`, `useSeries`, `useChartEvent`, `useCrosshair`, `useChartState` | Complete | Passed | react |
| `"use client"` interactive entry, SSR-safe mounting | Complete | Passed | react |
| `StaticChart` (line / area / candlestick SVG) via `@market-chart/react/ssr` | Complete | Passed | react |
| Synthetic datasets (BTC-, ETH-, EURUSD-, AAPL-, NASDAQ-, gold-, silver-like) and tick simulator | Complete | Passed | testing |
| Canvas mock for jsdom tests | Complete | Passed | testing |
| Playground (8 working examples) | Complete | Manual | apps/playground |

## Professional chart engine

| Feature | Status | Tests | Package |
|---|---|---|---|
| Left price scale (`priceScaleId: 'left'`, `leftPriceScale` options), shown only while used | Complete | Passed | core |
| Two-sided layout (left axis, panes, right axis) with independent axis widths | Complete | Passed | core |
| Axis interactions per side (drag scale, wheel scale, double-click reset) | Complete | Passed | core |
| Crosshair price labels on both axes | Complete | Manual | core |
| Last-value label collision avoidance; tick labels hidden under value labels | Complete | Passed | core |
| Per-series custom price formatter (`series.setPriceFormatter`, not serialised) | Complete | Passed | core |
| Drag-to-resize pane separators (`paneResize` event, `panes.minHeight`) | Complete | Passed | core |
| Kinetic scrolling (touch on, mouse off by default) | Complete | Passed | core |
| Touch crosshair: long-press shows, drag moves, tap hides | Complete | Passed | core |
| Keyboard navigation: ←/→ (Shift ×10), ↑/↓/+/−, Home, End, Esc; focusable surface with `ariaLabel` | Complete | Passed | core |
| Programmatic crosshair: `setCrosshairPosition(time, price?, pane?)`, `crosshairMove.source` | Complete | Passed | core |
| Two-chart crosshair sync built on the public API | Complete (example) | Manual | apps/playground |
| Empty price scales are cleared (no stale ticks after a series is removed) | Complete | Passed | core |

## Indicators

| Feature | Status | Tests | Package |
|---|---|---|---|
| Whitespace points (`{ time }`) for value series: lines break, areas close, histograms skip | Complete | Passed | core |
| Line point markers and `lineVisible` (dot plots) | Complete | Manual | core |
| Price lines API (`series.createPriceLine`): title, axis label, autoscale participation | Complete | Passed | core |
| Empty panes collapse anywhere (not only at the end); series `pane` indices are renumbered | Complete | Passed | core |
| Indicator engine: typed input schemas, validation, incremental runner (append / update-last via state snapshots) | Complete | Passed | indicators |
| Incremental primitives: SMA, EMA, RMA, WMA, rolling sum/max/min (monotonic deque), StdDev, lag, mean deviation | Complete | Passed | indicators |
| Pure `computeIndicator` (worker-safe input/output) | Complete | Passed | indicators |
| Registry with validation; `defineIndicator` / `calc` public development API | Complete | Passed | indicators |
| 13 trend indicators (SMA, EMA, WMA, VWMA, DEMA, TEMA, HMA, MA Ribbon, Supertrend, Parabolic SAR, ADX, Aroon, Ichimoku) | Complete | Passed | indicators |
| 11 momentum indicators (RSI, MACD, Stochastic, Stochastic RSI, CCI, ROC, Momentum, Williams %R, AO, UO, TRIX) | Complete | Passed | indicators |
| 7 volatility indicators (Bollinger, ATR, Keltner, Donchian, StdDev, Historical Volatility, Chaikin Volatility) | Complete | Passed | indicators |
| 8 volume indicators (Volume, OBV, VWAP, Anchored VWAP, MFI, CMF, A/D, Volume Oscillator) | Complete | Passed | indicators |
| 5 advanced indicators (Pivot Points ×4 types, CPR, Fibonacci levels, Support/Resistance, Premium/Discount) | Complete | Passed | indicators |
| Chart integration: output series, overlay vs pane placement, levels, band fills, offsets (Ichimoku) | Complete | Passed | indicators |
| Realtime: incremental updates on ticks and new bars; full recompute on `setData` / corrections | Complete | Passed | indicators |
| Indicator on indicator (any series can be a source) | Complete | Passed | indicators |
| Per-indicator style (colours, widths, visibility, fills, levels, value labels) | Complete | Passed | indicators |
| Serialise / restore with validation (invalid entries skipped and reported) | Complete | Passed | indicators |
| React: `useIndicator`, `<Indicator>`, `useIndicatorManager` | Complete | Passed | indicators/react |
| Worker transport for indicator calculation | Interface (`computeIndicator` is worker-safe) | Pending | indicators |
| Market Structure, Order Block, Fair Value Gap, Liquidity Zones | Planned (on the drawing layer; not started) | Pending | indicators / drawing-tools |

## Drawing tools

| Feature | Status | Tests | Package |
|---|---|---|---|
| Plugin input handlers (capture gestures before pan/zoom, hover cursors, keys, double-click), isolated failures | Complete | Passed | core |
| Overlay-only plugin redraw; time scale logical conversions (`timeToLogical`, `logicalToTime`, …) | Complete | Passed | core |
| Drawing model: data-space anchors, bar snapping, future times, per-series price mapping | Complete | Passed | drawing-tools |
| Creation by click-click and drag; one-click seeded tools; rubber-band preview; Escape cancels | Complete | Passed | drawing-tools |
| Selection (click, Shift+click), hover highlight, handles, move and handle editing | Complete | Passed | drawing-tools |
| Magnet snapping to OHLC (weak / strong) | Complete | Passed | drawing-tools |
| Undo/redo (one entry per drag), delete, copy/paste, z-order, lock, visibility, grouping | Complete | Passed | drawing-tools |
| Keyboard shortcuts (Delete, Ctrl/⌘+Z/Y/C/V, Esc) | Complete | Passed | drawing-tools |
| Versioned, validated JSON persistence with series-id mapping and migration hook | Complete | Passed | drawing-tools |
| Lines: trend line, ray, extended line, arrow, horizontal line, horizontal ray, vertical line | Complete | Passed | drawing-tools |
| Shapes: rectangle, circle, ellipse, parallel channel | Complete | Passed | drawing-tools |
| Text: text, note, callout, price label (text editing via the `textEdit` event) | Complete | Passed | drawing-tools |
| Measure: long/short position with risk/reward, price range, date range, date and price range | Complete | Passed | drawing-tools |
| Fibonacci: retracement, extension, fan, channel, time zones, arcs, wedge | Complete | Passed | drawing-tools |
| Gann fan, Gann box | Complete | Passed | drawing-tools |
| Pitchfork, Schiff pitchfork, regression channel, Elliott impulse/correction, cyclic lines | Complete | Passed | drawing-tools |
| Tool registry and custom tool API (`defineTool`, geometry and render helpers) | Complete | Passed | drawing-tools |
| Headless React toolbar state (`useDrawingToolbar`, `useDrawingManager`) | Complete | Manual | drawing-tools/react |
| Drawing toolbar example built on the headless hook | Complete (example) | Manual | apps/playground |
| Touch drawing (drag works; no long-press menus or enlarged touch handles yet) | Partial | Pending | drawing-tools |

## Advanced features

| Feature | Status | Tests | Package |
|---|---|---|---|
| Custom series API (`addCustomSeries`, OHLC or value envelope, custom painter/autoscale/colour) | Complete | Passed | core |
| Chart synchronisation (`createChartSync`): crosshair and visible time range, by time across different data | Complete | Passed | core |
| Plugin compatibility: `requires.core` semver range, versioned dependencies | Complete | Passed | core |
| `<ChartLayout>`: presets 1, 2h, 2v, 3, 4, 6, 8, 12 and custom CSS-grid layouts | Complete | Passed | react |
| Layout sync of crosshair, time range and zoom (`sync` prop, per-chart opt-out) | Complete | Passed | react |
| Layout symbol/interval state with optional linking (`useLayoutCell`) | Complete (state only; loading data is the app's or datafeed's job) | Passed | react |
| Heikin-Ashi, Renko (fixed/ATR, close/high-low), Line Break, Range bars, Tick bars, Spread | Complete | Passed | charts |
| Kagi and Point & Figure (transforms and renderers) | Complete | Passed | charts |
| Hollow candles, Volume candles | Complete | Passed | charts |
| Footprint (bid × ask, imbalances, POC), Delta volume, Cumulative Volume Delta (from trades) | Complete | Passed | charts |
| Liquidity heatmap from order-book snapshots | Complete | Passed | charts |
| Volume profile: visible range, fixed range (API), session; POC, value area; bars or trades | Complete | Passed | charts |
| Market profile / TPO: letters, POC, value area, initial balance | Complete | Passed | charts |
| Synthetic trades and order books for demos/tests | Complete | Passed | testing |
| Fixed-range volume profile as an interactive drawing tool | Planned | Pending | charts / drawing-tools |
| Market Structure, Order Block, Fair Value Gap, Liquidity Zones | Planned | Pending | indicators / charts |

## Datafeeds and persistence

| Feature | Status | Tests | Package |
|---|---|---|---|
| `Datafeed` contract (search, resolve, history, subscribe), `SymbolInfo` with precision, session, history bounds | Complete | Passed | datafeed |
| Timeframes `1s`–`1M`: parsing, UTC alignment (Monday weeks, calendar months), multiples | Complete | Passed | datafeed |
| Candle normalisation (aliases, arrays/objects, s/ms/ISO times, duplicates, high/low repair), merge, resample, gap fill, tick aggregation | Complete | Passed | datafeed |
| CSV / JSON parsing and local file import | Complete | Passed | datafeed |
| Static (in-memory) datafeed with resampling and realtime `push` | Complete | Passed | datafeed |
| REST datafeed: URL builders, chunking, retries with backoff (network, 429, 5xx), timeouts | Complete | Passed | datafeed |
| WebSocket datafeed: shared socket, ref-counted subscriptions, resubscribe, backoff reconnect, heartbeat, status | Complete | Passed | datafeed |
| SSE datafeed, composed datafeed (history + realtime from different sources), custom providers | Complete | Passed | datafeed |
| Synthetic datafeed (deterministic, unlimited history, latency, gaps, realtime) | Complete | Passed | datafeed |
| Chart binding: buffered subscribe-then-load, realtime bars/updates/corrections, history pagination, symbol/interval switching with stale-response protection, volume, gap filling | Complete | Passed | datafeed |
| `useDatafeed` / `<DatafeedSeries>` | Complete | Passed | datafeed/react |
| Storage adapters: memory, localStorage, sessionStorage, generic Web Storage, IndexedDB, REST, custom | Complete | Passed | persistence |
| Versioned schemas, step migrations, strict validation and sanitising of everything loaded/imported | Complete | Passed | persistence |
| `ChartPersistence`: options, exact visible range, symbol/interval, indicator and drawing state, app providers | Complete | Passed | persistence |
| Autosave (debounced, skipped when unchanged), manual save, save status events | Complete | Passed | persistence |
| Revision conflicts: overwrite, reload, fail, custom merge; REST `If-Match` / 409 / 412 | Complete | Passed | persistence |
| Cross-tab sync (BroadcastChannel) | Complete | Passed | persistence |
| JSON export/import (charts and workspaces) | Complete | Passed | persistence |
| Workspaces: create, rename, duplicate, delete, list, watchlists, preferences | Complete | Passed | persistence |
| `useChartPersistence` | Complete | Passed | persistence/react |
| Cloud sync | Partial — via the REST adapter and conflict handling; no hosted backend is provided | Passed | persistence |
| `symbol` / `interval` props directly on `<Chart>` | Planned — use `<DatafeedSeries>` inside `<Chart>` | Pending | react |

## SSR and optimisation

| Feature | Status | Tests | Package |
|---|---|---|---|
| Every entry point importable on a server with no browser API touched at import time | Complete | Passed (import traps) | all |
| SSR entry `@market-chart/react/ssr` isolated from the engine (only `react` + `core/static`) | Complete | Passed (source and built bundle) | react |
| Server rendering of all client components without a DOM | Complete | Passed | react, indicators, datafeed, persistence |
| Hydration without mismatches (`StaticChart`, `Chart`, `ProgressiveChart`) | Complete | Passed (jsdom and Chromium) | react |
| `ProgressiveChart`: SVG first, engine on mount / idle / visible / interaction | Complete | Passed | react |
| `"use client"` on interactive entries, plain main entries; Next.js App Router example (overview, progressive, interactive) | Complete | Passed (Next.js 16.2 build + browser) | react, apps/nextjs |
| `series.columns()` / `series.setColumns()` columnar data API | Complete | Passed | core |
| Time-axis rebuild without merge or allocation for series sharing times | Complete | Passed | core |
| Indicator recalculation from columns, shared inputs, columnar outputs | Complete | Passed | indicators |
| O(1) forming-bar updates in `DatafeedController` and static feed `push` | Complete | Passed | datafeed |
| Memory-aware history: `maxBars` in `DatafeedController` | Complete | Passed | datafeed |
| Benchmarks (100K/500K/1M load, render, pan, realtime, indicators, datafeed) with budgets | Complete | Passed | benchmarks |
| Memory profiling: bytes per candle, growth under sustained updates, create/destroy leak check | Complete | Passed | benchmarks |
| Real-canvas performance page (pan, zoom, realtime, heap) | Complete | Manual | apps/playground |
| `pnpm build` fixed (declaration build failed with `composite` project references) | Complete | Passed | all |
| OffscreenCanvas / worker rendering | Evaluated, not adopted (no measurable gain at ≤ 1 ms engine frames; see PERFORMANCE.md) | — | core |
| Built-in Web Worker for indicator calculation | Partial — `computeIndicator` is pure and transferable; no packaged worker | Passed (pure function) | indicators |
| Visual regression tests (Playwright) | Planned (release automation) | Pending | apps |

## Chart interface, internationalisation and customisation

### Internationalisation

| Feature | Status | Tests | Manual verification | Package |
|---|---|---|---|---|
| English, Persian and Arabic dictionaries covering every built-in interface text | Complete | Passed (every English key translated) | Playground RTL page | i18n |
| Custom languages (`register`), dictionaries (`extend`) and overrides | Complete | Passed | — | i18n |
| Typed keys (`TranslationKey`), English fallback, then the key | Complete | Passed (tsc + unit) | — | i18n |
| `{name}` interpolation with locale digits; plural forms via `Intl.PluralRules` (all six Arabic forms) | Complete | Passed | — | i18n |
| Switching without reload: provider prop, `setLocale`, settings and header language selectors | Complete | Passed (jsdom and Chromium) | — | i18n, react, ui |
| Browser language detection (`'auto'`), read lazily; resolved after hydration in React | Complete | Passed | — | i18n, react |
| Application default (`defaultLocale`) and per-workspace preference (saved with the layout) | Complete | Passed | — | ui |
| Locale number and date formatting; Persian and Arabic digits (optional on chart axes) | Complete | Passed | Playground RTL page | core, i18n |
| `chart.setLocale/getLocale/setDirection/getDirection`, `localeChange` / `directionChange` events | Complete | Passed (jsdom and Chromium) | — | core |
| `<ChartProvider locale direction i18n>`, `useTranslation`, `useLocale`, `useDirection`, `<Chart syncLocale>` | Complete | Passed | — | react |
| RTL: mirrored header sections, sidebar side, menus and submenus, arrow keys, directional icons, dialogs, price-line titles | Complete | Passed (unit, jsdom, Chromium positioning) | Playground RTL page | core, ui |
| RTL time axis | Partial — time keeps its left-to-right order (labels localised, not reversed) | Passed | Playground RTL page | core |
| Non-Gregorian calendars on the axes | Planned — axis dates are Gregorian with localised month names | Passed (Gregorian) | — | core |
| Translated indicator names | Partial — 25 most common indicators; others show their English names | Passed | — | i18n |

### Context menus

| Feature | Status | Tests | Manual verification | Package |
|---|---|---|---|---|
| Core `contextMenu` event: pane, side, time, logical index, price, series hits; native menu kept without listeners | Complete | Passed (jsdom and Chromium) | — | core |
| Triggers: right-click, ContextMenu key, Shift+F10 | Complete | Passed (jsdom and Chromium) | — | core, ui |
| Touch long-press (`interaction.touchContextMenu`) | Partial — tested with synthetic pointer events, not on a physical touch device | Passed (unit) | — | core, ui |
| Targets: chart, pane, candlestick, series, indicator, drawing, drawing handle, price axis, time axis | Complete | Passed (real chart and managers) | Playground context-menu page (background, candle) | ui |
| Built-in actions for each target (view, point, drawing, indicator, axis), using the drawing and indicator managers | Complete | Passed | — | ui, drawing-tools, indicators |
| Action registry: id, translation key, icon, category, targets, shortcut, enabled, visible, run, submenu, confirmation, owner, order | Complete | Passed | — | ui |
| `register`, `unregister`, `getActions`, `setEnabled`, `setHidden`, `unregisterOwner`, `override`/`restore` | Complete | Passed | Playground context-menu page (custom, conditional and plugin actions) | ui |
| Nested submenus, search, type-ahead, keyboard navigation, focus capture and restore | Complete | Passed (unit, jsdom, Chromium) | — | ui |
| Dismissal: outside click, Escape, scroll, resize, blur | Complete | Passed (jsdom and Chromium) | — | ui |
| Viewport- and RTL-aware positioning with flipping and clamping | Complete | Passed (unit and Chromium) | Playground RTL page (opens left), context-menu page (flips at the right edge) | ui |
| Confirmation inside the menu | Complete | Passed | — | ui |
| Themes (light, dark, density, forced colours, reduced motion) | Partial — dark theme checked by hand; light, density, forced-colour and reduced-motion styles have no automated test | — | Playground (dark menus and toolbars) | ui/react |
| Headless API (`useContextMenu`, `ContextMenuController`) for custom renderers | Complete | Passed | Playground context-menu page (custom renderer) | ui |

### Header, sidebar and settings

| Feature | Status | Tests | Manual verification | Package |
|---|---|---|---|---|
| One action registry for context menu, header, sidebar, shortcuts and settings | Complete | Passed | — | ui |
| Header: start / center / end sections, groups, buttons, toggles, selects, dropdowns, tooltips, roving focus | Complete | Passed (jsdom and Chromium) | — | ui/react |
| Responsive header overflow ("More" menu) | Partial — widths measured after render and corrected on the next frame | Passed (Chromium) | Playground integrated page (header fits after overflow) | ui/react |
| Custom actions, icons (`registerIcon`) and components in toolbars | Complete | Passed | — | ui |
| Shortcuts: platform-aware (`Mod`), user-editable, shown in menus and tooltips | Complete | Passed | — | ui |
| Sidebar: start/end side, expanded, collapsed, floating (draggable), hidden; tool-category flyouts; mobile layout below 640 px | Complete | Passed (jsdom) | — | ui/react |
| Drawing tools and indicators from the existing `DrawingManager` and `IndicatorManager` (no duplicated logic) | Complete | Passed | — | ui |
| Object tree and data window panels; indicator settings and drawing property dialogs | Complete | Passed (drawing properties) | — | ui/react |
| Settings: General, Appearance, Header, Sidebar, Context menu, Language, Keyboard shortcuts | Complete | Passed | Playground RTL page (dialog mirrored, Header tab) | ui/react |
| Rearranging toolbar actions | Partial — drag and drop and arrow buttons in the settings dialog; not by dragging on the toolbars | Passed (unit) | — | ui |
| Preferences through `@market-chart/persistence`: versioned, migrations, validation, debounced autosave, export/import, restore defaults | Complete | Passed | — | ui |
| `uiPreferencesProvider` for `ChartPersistence` layouts and workspaces | Complete | Passed | — | ui |

### Cross-cutting

| Requirement | Status | Tests | Package |
|---|---|---|---|
| Engine stays UI-free (no menus, toolbars or React in `core`) | Complete | Passed (build import boundaries) | core |
| SSR-safe imports, `"use client"` React entry, hydration in RTL | Complete | Passed | i18n, ui |
| Tree-shakable ESM + CJS; headless `ui` without React; lazy settings chunk | Complete | Passed (build) | i18n, ui |
| Performance budgets unchanged | Complete | Passed (11/11) | benchmarks |
| Accessibility: ARIA menus, toolbars and dialogs, focus traps, keyboard access, forced colours, reduced motion | Partial — keyboard and ARIA covered by tests; not audited with a screen reader | Passed | ui/react |
| Playground: 9 demos on 6 pages | Complete | — (all pages load without console errors) | apps/playground |
| Docs: [i18n README](packages/i18n/README.md), [ui README](packages/ui/README.md), architecture §12 | Complete | — | docs |
| No new dependencies | Complete | — | all |

## Legend, price labels, object tree, documentation site

### Legend and price labels

| Feature | Status | Tests | Manual verification | Package |
|---|---|---|---|---|
| Legend over the chart: title, date, time, timestamp, open, high, low, close (coloured by direction), change (amount and %), volume — for the hovered bar, or the last bar | Complete | Passed (unit, jsdom, Chromium) | Docs site: home, examples, builder | ui |
| Volume from the bar or from a separate volume histogram | Complete | Passed | Docs site examples | ui |
| Indicator rows with values in the output colours; hide, settings, remove buttons; collapse | Complete | Passed | Docs site examples | ui/react |
| Legend fields as user preferences; Settings → Legend and price labels; context-menu toggle; gear and hide buttons | Complete | Passed (jsdom and Chromium) | Docs site examples | ui |
| Translated labels (English, Persian, Arabic); digits follow the axes' local-digits setting | Complete | Passed | Docs builder in Persian | ui, i18n |
| `ui.legend(time)` headless data for custom legends; `<ChartLegend>` standalone | Complete | Passed | — | ui |
| Visible high and low as price lines with axis labels, following scrolling and zooming | Complete | Passed (unit and Chromium) | Docs site examples | ui (engine price lines) |
| Previous-close line | Complete | Passed | Docs site examples | ui |
| Switches for the last-price line, last-price label and indicator labels, applied only once the user changes them | Complete | Passed | — | ui |
| Context-menu submenu "Price labels on the chart" (chart and price-axis targets) | Complete | Passed | — | ui |
| Preferences version 2 with migration from version 1 | Complete | Passed | — | ui |

### Object tree

| Feature | Status | Tests | Manual verification | Package |
|---|---|---|---|---|
| Series section with last value and show/hide | Complete | Passed (jsdom) | — | ui/react |
| Indicators with show/hide, settings and remove; drawings with select, show/hide, lock, properties and delete | Complete | Passed | — | ui/react |
| Price-label toggles with the current high/low and previous-close values | Complete | Passed (jsdom) | — | ui/react |

### Fix

| Feature | Status | Tests | Manual verification | Package |
|---|---|---|---|---|
| `DatafeedController` stops itself when its chart is destroyed first. React destroys the chart in a layout-effect cleanup before the datafeed's passive-effect cleanup, and a realtime tick in between used to throw | Complete | Passed (unit and Chromium) | Docs site: navigating away from realtime examples | datafeed |

### Documentation site (`apps/docs`)

| Feature | Status | Tests | Manual verification | Package |
|---|---|---|---|---|
| React site with 25 pages: home, getting started, live examples, chart builder, 10 package pages, 3 guides, 5 references, status, develop and publish, license | Complete | Manual (strict tsc, ESLint, production build) | All 25 pages loaded in the browser without errors or failed examples | apps/docs |
| Package pages render the package READMEs (`?raw` imports), so the docs follow the repository | Complete | Manual | Every package page | apps/docs |
| Live examples whose code tabs show the running source files | Complete | Manual | Examples page | apps/docs |
| Chart builder: series, theme, crosshair, volume, indicators with parameters, interface options, language, legend fields, price labels; live chart and generated code | Complete | Manual | Series change, adding an indicator, Persian (RTL interface and correct provider placement in the code) | apps/docs |
| Reference generated from the packages at runtime: indicators (inputs, outputs, live preview), drawing tools (try on a chart), interface actions, chart options with defaults, translations (en/fa/ar, missing keys), exports of every entry point | Complete | Manual | Each reference page | apps/docs |
| Search (Ctrl+K or /) over pages, document headings, indicators, tools and actions | Complete | Manual | Searches for an indicator and for "legend" | apps/docs |
| Light and dark themes, language switch for the examples, responsive layout with mobile menu, skip link, table of contents, previous/next | Complete | Manual | Desktop (1440 px) and phone (375 px) | apps/docs |
| Automated tests for the docs site | Planned | Pending | — | apps/docs |

## Planned

| Feature | Status | Tests | Package |
|---|---|---|---|
| Visual regression (Playwright), CI workflow running tests, build and benchmarks | Planned (release automation) | Pending | root |
| CI/CD release workflow | Planned (release automation) | Pending | root |

## Known limitations

- The time axis is index-based: gaps (weekends, missing candles) are not shown as empty space.
- Session-based indicators (VWAP, pivots, CPR) use UTC boundaries; exchange sessions and time zones are not yet supported.
- Ichimoku future points use the last bar interval; with irregular data the projected times are approximations until real bars arrive.
- Renko, Kagi, Point & Figure and Line Break place each element at the time of the bar that formed it (+1 ms for several per bar); their time axis shows bar times, not a regular calendar.
- Volume/market profiles use UTC sessions; with OHLCV bars, volume is spread evenly over each bar's range.
- Drawing tools: the core package stays headless; `@market-chart/ui` provides the property dialog, a text editing dialog and the long-press menu.
- Pane indices are compacted: removing a series from a middle pane that becomes empty moves the panes below it up.
- `fitContent()` is limited by `timeScale.minBarSpacing` (default 0.5 px). Visible bars are capped at about
  2× the pane width, which keeps per-frame cost independent of dataset size; a dataset of 1M bars cannot be
  shown in full at once.
- The crosshair label is drawn above last-value labels and can cover one of them while hovering.
- When many labels compete for a short pane, the stack can extend past the top edge.
- Pane heights set by dragging are kept as stretch factors in pixels; resizing the whole chart rescales them proportionally.
- Kinetic scrolling and the touch crosshair were verified with unit tests and synthetic events, not yet on a physical touch device.
- The datafeed controller drops old bars only when `maxBars` is set; without it, very long sessions keep growing.
- Replacing 1M bars with several indicators attached takes 1.5–2 s, mostly garbage collection; prefer `update()` and history paging.
- `fillGaps` fills by calendar; it does not know exchange holidays or sessions, so use it for 24/7 markets only.
- The SSE adapter is tested with an `EventSource` stand-in, not against a live server.
- Persistence stores the visible range by time; if the restored chart has different data around that range, the nearest bars are shown.
- Only the Canvas 2D backend exists. No WebGL backend exists yet, and none will be added unless benchmarks justify it.
- Axis dates use the Gregorian calendar in every language (localised month names and digits); the time axis
  keeps its left-to-right order in RTL.
- When `@market-chart/ui` is attached, a touch long-press opens the context menu instead of the touch
  crosshair (`touchContextMenu: false` keeps the crosshair).
- Moving an indicator to another pane is not part of the indicator manager's `config()`, so persistence
  restores it in its original pane.
- The header's overflow is measured after rendering; one frame can show an item that then moves to "More".
- Price-line titles (High, Low, Prev close) are drawn at the pane's left edge and sit under the legend; the
  legend rows have a translucent background and the axis labels show the prices.
- The documentation text is English; the live examples follow the language chosen in the site header.
