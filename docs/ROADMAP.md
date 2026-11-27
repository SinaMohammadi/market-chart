# Roadmap

What market-chart needs after `0.1.1`, in priority order. Each item says why it matters and how to know it is
done. Feature status and test coverage are tracked in [FEATURE_MATRIX.md](../FEATURE_MATRIX.md); this page is
the plan. Versions follow semantic versioning for `0.x`: patch releases fix, minor releases add (and may still
break before 1.0), and every change is described in the package changelogs.

- [Now: project hygiene (0.1.x)](#now-project-hygiene-01x)
- [Next: close the verification gaps (0.2)](#next-close-the-verification-gaps-02)
- [Next: usability fixes (0.2)](#next-usability-fixes-02)
- [Later: new features (0.3 and after)](#later-new-features-03-and-after)
- [Before 1.0](#before-10)
- [Ongoing for every release](#ongoing-for-every-release)

---

## Now: project hygiene (0.1.x)

These protect every later release. None changes the public API.

| Item                                      | Why                                                                                                                                                  | Done when                                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commit the generated `CHANGELOG.md` files | The `0.1.1` changelogs exist locally but were not committed; npm and GitHub readers cannot see what changed                                          | Every package folder has a committed `CHANGELOG.md`; `changeset version` output is committed with each release                                                                     |
| CI for pull requests and `main`           | Today only the documentation is built on GitHub; tests, types, lint and formatting run only on a developer's machine                                 | A workflow runs `pnpm install --frozen-lockfile`, `build`, `typecheck`, `test`, `lint`, `format:check` and `docs:build` on every pull request; `main` is protected and requires it |
| Real-browser tests in CI                  | The `*.browser.test.*` suites (dragging, focus traps, menu placement, virtualised lists) skip themselves under jsdom and ran only in a local harness | They run headless in Playwright (Chromium) in CI                                                                                                                                   |
| Browser and runtime matrix                | `engines` says Node 20+, peers say React 18+, but tests ran on Node 24 and React 19 only, and real-browser tests on Chromium only                    | CI runs unit tests on Node 20, 22 and 24, React tests on React 18 and 19, and the browser suites on Chromium, Firefox and WebKit                                                   |
| Release from CI with npm provenance       | Releases are published from a laptop with a token                                                                                                    | Changesets "Version packages" pull request plus publish from GitHub Actions with provenance (or npm trusted publishing); 2FA required for the organisation                         |
| Development dependency updates            | The security review found advisories in development tools only (Vitest, esbuild through tsup)                                                        | Vitest 4 (move `poolOptions` in `vitest.bench.config.ts` to the new pool settings), current tsup; `pnpm audit` clean; benchmarks still within budget                               |
| Repository automation                     | No automatic dependency or code scanning                                                                                                             | Dependabot (npm and GitHub Actions), CodeQL for JavaScript/TypeScript, secret scanning and private vulnerability reporting switched on                                             |
| Contributor files                         | Outside contributors have no guidance                                                                                                                | `CONTRIBUTING.md` (setup, tests, changesets, style), issue and pull-request templates, a code of conduct                                                                           |
| Feature matrix housekeeping               | A few rows predate later work (e.g. "configs; not yet executed" for builds that now run in every release)                                            | Every row reflects the current state and the last verification run                                                                                                                 |
| Bundle-size budgets                       | The opt-in features are measured to cost nothing when unused; nothing prevents a regression                                                          | A size check (e.g. esbuild metafile in CI) fails when the minimal `core` and `ui` bundles grow past a set budget                                                                   |

## Next: close the verification gaps (0.2)

Features that are implemented and tested automatically, but not yet checked where it matters most.

| Item                            | Why                                                                                                                             | Done when                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Physical touch devices          | Kinetic scrolling, touch crosshair, long-press menus, pinch zoom and order-line dragging were tested with synthetic events only | Checked on at least one iOS and one Android device; findings fixed and recorded                                                   |
| Screen-reader audit             | ARIA roles and keyboard paths are tested, but no screen reader was used                                                         | NVDA (Windows) and VoiceOver (macOS/iOS) walkthrough of menus, dialogs, symbol search, order ticket and object tree; issues fixed |
| Real-canvas trading performance | 1,000 orders keep the engine benchmark within budget, but real-canvas frame times were not measured                             | Playground "Add 1,000 orders" measured in Chromium, Firefox and Safari; numbers in `PERFORMANCE.md`                               |
| Themes beyond dark              | Light theme, compact density, forced colours and reduced motion were not all checked by hand                                    | Each checked in a browser; visual regression snapshots added                                                                      |
| Visual regression tests         | Rendering changes are caught only by unit tests and manual looks                                                                | Playwright screenshots of the main chart types, RTL interface and dialogs, compared in CI                                         |
| Next.js example at runtime      | Its security headers and server rendering were built but not run in this cycle                                                  | `next build` and `next start` checked in CI; headers verified                                                                     |
| Live SSE server                 | The SSE adapter is tested against a stand-in                                                                                    | Integration test against a small local SSE server                                                                                 |

## Next: usability fixes (0.2)

Known limitations users will hit, each small to medium.

| Item                                                 | Package         | Notes                                                                                                |
| ---------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| Shortcuts on macOS with `Alt`                        | ui              | `Alt`+letter produces another character on macOS; match on `event.code` as well as `event.key`       |
| Price actions in the shortcut settings               | ui              | They need a price, so they are hidden there today; list them with a sample price                     |
| Several trading overlays on one `ChartUi`            | trading         | Only the first registers the context-menu actions; route actions to the overlay that owns the target |
| Crowded axis labels with large order books           | trading, core   | Group or thin axis labels when hundreds of orders share a small price range                          |
| Moving an indicator to another pane is not persisted | indicators      | Include the pane in `config()` and restore it                                                        |
| Touch drawing                                        | drawing-tools   | Enlarged handles and long-press menus for drawings on touch screens                                  |
| Indicator names in Persian and Arabic                | i18n            | 25 of 44 indicators are translated; complete the rest                                                |
| `symbol` and `interval` props on `<Chart>`           | react, datafeed | Today a `DatafeedController` or `<DatafeedSeries>` is needed                                         |
| Label stack overflow in short panes                  | core            | Keep axis labels inside the pane when many compete for little space                                  |
| Header overflow flicker                              | ui              | Measure before the first paint so no item jumps to "More" one frame late                             |

## Later: new features (0.3 and after)

Larger additions, roughly in order of user value. Each should land with tests, documentation, a live example
and a feature-matrix row.

1. **Exchange sessions and time zones** for session-based indicators (VWAP, pivots, CPR), volume profiles and
   `fillGaps` (holidays, half days), instead of UTC boundaries.
2. **Trading-session-aware time axis option**, showing gaps (weekends, closed sessions) for those who want a
   calendar axis instead of the index axis.
3. **Cumulative volume delta as an indicator** in the indicator manager, fed by per-trade buy/sell volume. It
   already exists in `@market-chart/charts` for footprint and order-flow views, but not as a regular indicator
   on any chart.
4. **Market structure tools**: market structure breaks, order blocks, fair value gaps, liquidity zones, built on
   the drawing layer.
5. **Fixed-range volume profile as a drawing tool**, editable on the chart.
6. **More drawing tools**: Elliott triangle and combination waves, modified Schiff pitchfork, Gann square and
   fixed boxes; drawings shared between charts of a layout.
7. **Indicator worker transport**: a ready-made Web Worker wrapper around `computeIndicator` for very large
   recalculations.
8. **Alerts manager in the UI**: list, edit and trigger state of the application's alerts (the trading overlay
   already draws them).
9. **Non-Gregorian calendars** on the time axis (Persian/Jalali, Hijri) as an option.
10. **Cloud sync helpers** for layouts and preferences beyond the REST adapter (conflict-aware sync between
    devices).
11. **WebGL backend**: only if benchmarks show Canvas 2D limits for real workloads (for example very dense
    heatmaps); the renderer interface already allows it.

## Before 1.0

1.0 means the public API is stable: breaking changes only in a new major version.

- **API review.** Go through every export of every package: names, option shapes, events, error types. Remove
  or mark experimental what should not be frozen. Record the decisions.
- **Generated API reference** (TypeDoc or similar) published with the documentation site, so every export has
  a page.
- **Deprecation policy.** Deprecated APIs keep working, warn in development, and are removed only in the next
  major version; documented in the README.
- **Support policy.** Supported Node versions, React versions and browsers, published and enforced by the CI
  matrix.
- **Accessibility statement** based on the screen-reader audit, with known gaps.
- **Security review refresh** of everything added since the last review (symbol search, price actions, order
  ticket, trading overlay, timeline synchronisation), and an external review if possible.
- **Performance budgets in CI.** `pnpm bench` runs on a fixed CI machine and fails on regressions.
- **Migration guide** from the last `0.x` to `1.0`.
- **Stable storage formats.** Layout, workspace, drawing and preference schemas frozen at a version with tested
  migrations from every earlier version.

## Ongoing for every release

- A changeset for every user-visible change; release notes on GitHub from the changelog.
- Tests for every fix that fail without it.
- `FEATURE_MATRIX.md` updated with honest statuses and the verification actually done.
- Example data stays synthetic and labelled; trading examples stay simulated.
- No package installs scripts, no runtime dependencies in `core`, every entry import-safe on the server.
- Documentation updated in the same pull request as the code.
